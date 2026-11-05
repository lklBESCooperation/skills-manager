"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SKILL_PACKAGE_OBSERVATION_LIMITS = void 0;
exports.observedSkillPackagesMatch = observedSkillPackagesMatch;
exports.isOsMetadataSkillEntryName = isOsMetadataSkillEntryName;
exports.describeObservedSkillFile = describeObservedSkillFile;
exports.skillPackageDigest = skillPackageDigest;
exports.observeSkillPackage = observeSkillPackage;
exports.matchesBundledSkillFiles = matchesBundledSkillFiles;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
function observedSkillPackagesMatch(left, right) {
    return (left.files.length === right.files.length &&
        left.files.every((file, index) => {
            const other = right.files[index];
            return (file.path === other.path &&
                file.size === other.size &&
                file.executable === other.executable &&
                file.classification === other.classification &&
                file.exactSha256 === other.exactSha256 &&
                file.identitySha256 === other.identitySha256);
        }));
}
// Ignore only plain OS metadata files, mirrored in the bundle generator, or Finder visits mark pristine copies outdated. Preserve mode-bit identity for real scripts.
const OS_METADATA_FILE_NAMES = new Set(['.ds_store', 'thumbs.db', 'ehthumbs.db', 'desktop.ini']);
function isOsMetadataSkillEntryName(name) {
    const folded = name.toLocaleLowerCase('en-US');
    // AppleDouble sidecars appear when the filesystem cannot store macOS metadata inline.
    return OS_METADATA_FILE_NAMES.has(folded) || folded.startsWith('._');
}
exports.SKILL_PACKAGE_OBSERVATION_LIMITS = {
    maximumDepth: 16,
    maximumEntries: 2_048,
    maximumFiles: 512,
    maximumSingleFileBytes: 4 * 1024 * 1024,
    maximumTotalBytes: 32 * 1024 * 1024
};
async function readBoundedSkillFile(path, remainingTotalBytes, maximumSingleFileBytes, signal) {
    const handle = await (0, promises_1.open)(path, 'r');
    try {
        const before = await handle.stat();
        if (before.size > maximumSingleFileBytes) {
            throw new Error('skill-package-file-size-limit');
        }
        if (before.size > remainingTotalBytes) {
            throw new Error('skill-package-total-size-limit');
        }
        const bytes = Buffer.alloc(before.size);
        let offset = 0;
        while (offset < bytes.length) {
            if (signal?.aborted) {
                throw new Error('skill-install-cancelled');
            }
            const result = await handle.read(bytes, offset, bytes.length - offset, offset);
            if (result.bytesRead === 0) {
                throw new Error('skill-package-changed-during-read');
            }
            offset += result.bytesRead;
        }
        if ((await handle.stat()).size !== before.size) {
            throw new Error('skill-package-changed-during-read');
        }
        return bytes;
    }
    finally {
        await handle.close();
    }
}
function sha256(bytes) {
    return (0, node_crypto_1.createHash)('sha256').update(bytes).digest('hex');
}
function compareCodeUnits(left, right) {
    return left === right ? 0 : left < right ? -1 : 1;
}
function normalizedText(bytes) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return Buffer.from(text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'), 'utf8');
}
function describeObservedSkillFile(path, bytes, executable) {
    let normalized = null;
    if (!bytes.includes(0)) {
        try {
            normalized = normalizedText(bytes);
        }
        catch {
            normalized = null;
        }
    }
    const exactSha256 = sha256(bytes);
    const textNormalizedSha256 = normalized && (normalized.equals(bytes) ? exactSha256 : sha256(normalized));
    return {
        path,
        size: bytes.length,
        executable,
        classification: normalized ? 'text' : 'binary',
        exactSha256,
        textNormalizedSha256,
        identitySha256: textNormalizedSha256 !== null && !executable ? textNormalizedSha256 : exactSha256
    };
}
function skillPackageDigest(files) {
    return sha256(Buffer.from(JSON.stringify(files.map((file) => ({
        path: file.path,
        executable: file.executable,
        classification: file.classification,
        identitySha256: file.identitySha256
    })))));
}
function matchesFileIdentity(actual, expected) {
    if (actual.path !== expected.path ||
        actual.executable !== expected.executable ||
        actual.classification !== expected.classification) {
        return false;
    }
    return expected.classification === 'text' && !expected.executable
        ? actual.textNormalizedSha256 === expected.textNormalizedSha256
        : actual.exactSha256 === expected.exactSha256;
}
async function observeSkillPackage(packageRoot, limits = exports.SKILL_PACKAGE_OBSERVATION_LIMITS, executablePaths, signal, platform = process.platform, inferShebangExecutables = false) {
    const files = [];
    const caseFoldedPaths = new Map();
    const normalizedExecutablePaths = platform === 'win32' && executablePaths
        ? new Set([...executablePaths].map((path) => path.toLocaleLowerCase('en-US')))
        : executablePaths;
    let entryCount = 0;
    let totalBytes = 0;
    async function visit(directory, depth) {
        if (signal?.aborted) {
            throw new Error('skill-install-cancelled');
        }
        const directoryHandle = await (0, promises_1.opendir)(directory);
        const entries = [];
        try {
            for (;;) {
                const entry = await directoryHandle.read();
                if (!entry) {
                    break;
                }
                entryCount += 1;
                if (entryCount > limits.maximumEntries) {
                    throw new Error('skill-package-entry-limit');
                }
                entries.push(entry);
            }
        }
        finally {
            await directoryHandle.close().catch(() => undefined);
        }
        // Use code-unit ordering so runtime/build ICU differences cannot change identity.
        entries.sort((left, right) => compareCodeUnits(left.name, right.name));
        for (const entry of entries) {
            if (signal?.aborted) {
                throw new Error('skill-install-cancelled');
            }
            const absolutePath = (0, node_path_1.join)(directory, entry.name);
            // Ignore metadata only when absent or a plain file; links/directories must still pass content guards. Filter before case-folding so sidecar spellings cannot collide.
            if (isOsMetadataSkillEntryName(entry.name)) {
                const sidecarStat = await (0, promises_1.lstat)(absolutePath).catch(() => null);
                if (!sidecarStat || sidecarStat.isFile()) {
                    continue;
                }
            }
            const relativePath = (0, node_path_1.relative)(packageRoot, absolutePath);
            if ((0, node_path_1.isAbsolute)(relativePath) ||
                relativePath === '..' ||
                relativePath.startsWith(`..${node_path_1.sep}`)) {
                throw new Error('skill-path-escape');
            }
            const manifestPath = relativePath.split(node_path_1.sep).join('/');
            const folded = manifestPath.toLocaleLowerCase('en-US');
            const collision = caseFoldedPaths.get(folded);
            if (collision && collision !== manifestPath) {
                throw new Error('skill-case-collision');
            }
            caseFoldedPaths.set(folded, manifestPath);
            const fileStat = await (0, promises_1.lstat)(absolutePath);
            if (fileStat.isSymbolicLink()) {
                throw new Error('skill-package-link');
            }
            if (fileStat.isDirectory()) {
                if (depth >= limits.maximumDepth) {
                    throw new Error('skill-package-depth-limit');
                }
                await visit(absolutePath, depth + 1);
            }
            else if (fileStat.isFile()) {
                if (fileStat.nlink !== 1) {
                    throw new Error('skill-package-link');
                }
                if (files.length >= limits.maximumFiles) {
                    throw new Error('skill-package-file-count-limit');
                }
                const bytes = await readBoundedSkillFile(absolutePath, limits.maximumTotalBytes - totalBytes, limits.maximumSingleFileBytes, signal);
                totalBytes += bytes.length;
                const executable = normalizedExecutablePaths
                    ? normalizedExecutablePaths.has(platform === 'win32' ? folded : manifestPath)
                    : platform === 'win32' && inferShebangExecutables
                        ? bytes.subarray(0, 2).equals(Buffer.from('#!'))
                        : (fileStat.mode & 0o111) !== 0;
                files.push(describeObservedSkillFile(manifestPath, bytes, executable));
            }
            else {
                throw new Error('skill-package-special-file');
            }
        }
    }
    await visit(packageRoot, 0);
    return { files, observedDigest: skillPackageDigest(files) };
}
/** Require every bundled file identity; tolerate extra agent metadata such as agents/openai.yaml beside unchanged official bytes. */
function matchesBundledSkillFiles(observed, expectedFiles) {
    const observedByPath = new Map(observed.files.map((file) => [file.path, file]));
    return expectedFiles.every((expected) => {
        const actual = observedByPath.get(expected.path);
        return Boolean(actual && matchesFileIdentity(actual, expected));
    });
}
