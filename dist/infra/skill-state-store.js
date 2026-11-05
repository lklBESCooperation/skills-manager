"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.skillInstallStateKey = skillInstallStateKey;
exports.skillInstallReceiptPath = skillInstallReceiptPath;
exports.writeSkillStateFile = writeSkillStateFile;
exports.writeSkillInstallReceipt = writeSkillInstallReceipt;
exports.readSkillInstallReceipt = readSkillInstallReceipt;
// Ported from src/main/skills/skill-install-provenance.ts (upstream-shared).
// Only the state-file primitives the vault/enablement core needs; receipt
// listing stayed with the host installer. Re-sync on upstream provenance edits.
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const skill_filesystem_retry_1 = require("./skill-filesystem-retry");
function normalizedSkillInstallPath(canonicalPath) {
    const normalized = (0, node_path_1.resolve)(canonicalPath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
function skillInstallStateKey(canonicalPath) {
    return (0, node_crypto_1.createHash)('sha256').update(normalizedSkillInstallPath(canonicalPath)).digest('hex');
}
function skillInstallReceiptPath(stateDirectory, canonicalPath) {
    return (0, node_path_1.join)(stateDirectory, 'receipts', `${skillInstallStateKey(canonicalPath)}.json`);
}
async function writeSkillStateFile(path, value) {
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    const handle = await (0, promises_1.open)(temporary, 'wx', 0o600);
    try {
        await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    try {
        await (0, skill_filesystem_retry_1.renameSkillPathWithWindowsRetry)(temporary, path);
    }
    finally {
        await (0, promises_1.rm)(temporary, { force: true }).catch(() => undefined);
    }
}
async function writeSkillInstallReceipt(stateDirectory, receipt) {
    await writeSkillStateFile(skillInstallReceiptPath(stateDirectory, receipt.canonicalPath), receipt);
}
function isReceipt(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    // SAFETY: each accessed field is validated below before the value is accepted.
    const receipt = value;
    return (receipt.schemaVersion === 1 &&
        typeof receipt.packageId === 'string' &&
        typeof receipt.versionId === 'string' &&
        typeof receipt.packageDigest === 'string' &&
        (receipt.bundleDigest === undefined || typeof receipt.bundleDigest === 'string') &&
        typeof receipt.archiveSha256 === 'string' &&
        (receipt.scope === 'global' || receipt.scope === 'workspace') &&
        typeof receipt.destinationIdentity === 'string' &&
        typeof receipt.canonicalPath === 'string' &&
        Array.isArray(receipt.placements) &&
        (receipt.providers === undefined ||
            (Array.isArray(receipt.providers) &&
                receipt.providers.every((provider) => typeof provider === 'string'))) &&
        typeof receipt.installedAt === 'string' &&
        typeof receipt.hostIdentity === 'string' &&
        (receipt.fileModes === undefined ||
            (Array.isArray(receipt.fileModes) &&
                receipt.fileModes.every((file) => typeof file.path === 'string' && typeof file.executable === 'boolean'))) &&
        (receipt.wslDistro === undefined || typeof receipt.wslDistro === 'string'));
}
async function readSkillInstallReceipt(stateDirectory, canonicalPath) {
    try {
        const parsed = JSON.parse(await (0, promises_1.readFile)(skillInstallReceiptPath(stateDirectory, canonicalPath), 'utf8'));
        return isReceipt(parsed) &&
            normalizedSkillInstallPath(parsed.canonicalPath) === normalizedSkillInstallPath(canonicalPath)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
