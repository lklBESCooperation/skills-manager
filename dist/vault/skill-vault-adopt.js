"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nativeSkillVaultAdoptFilesystem = void 0;
exports.adoptSkillsIntoVault = adoptSkillsIntoVault;
exports.unadoptSkillFromVault = unadoptSkillFromVault;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const staging_marker_1 = require("./staging-marker");
const skill_filesystem_retry_1 = require("../infra/skill-filesystem-retry");
const skill_metadata_1 = require("../contracts/skill-metadata");
const skill_vault_index_service_1 = require("./skill-vault-index-service");
const skill_vault_paths_1 = require("./skill-vault-paths");
exports.nativeSkillVaultAdoptFilesystem = {
    mkdir: async (path) => {
        await (0, promises_1.mkdir)(path, { recursive: true });
    },
    rename: skill_filesystem_retry_1.renameSkillPathWithWindowsRetry,
    remove: (path) => (0, promises_1.rm)(path, { recursive: true, force: true }),
    symlink: (target, path, kind) => (0, promises_1.symlink)(target, path, kind),
    copyTree: (source, target) => (0, promises_1.cp)(source, target, { recursive: true, verbatimSymlinks: true }),
    readFile: (path) => (0, promises_1.readFile)(path, 'utf8'),
    lstat: (path) => (0, promises_1.lstat)(path).catch(() => null)
};
function stagePathFor(target) {
    return (0, node_path_1.join)((0, node_path_1.dirname)(target), `.${(0, node_path_1.basename)(target)}${staging_marker_1.SKILL_VAULT_STAGE_MARKER}${(0, node_crypto_1.randomUUID)()}`);
}
/** Windows needs no privilege for junctions; POSIX gets a relative dir link. */
async function createVaultLink(vaultPath, originPath, filesystem) {
    await filesystem.mkdir((0, node_path_1.dirname)(originPath));
    if (process.platform === 'win32') {
        await filesystem.symlink((0, node_path_1.resolve)(vaultPath), originPath, 'junction');
        return;
    }
    const realOriginParent = await (0, promises_1.realpath)((0, node_path_1.dirname)(originPath)).catch(() => (0, node_path_1.resolve)((0, node_path_1.dirname)(originPath)));
    const realVaultPath = await (0, promises_1.realpath)(vaultPath).catch(() => (0, node_path_1.resolve)(vaultPath));
    await filesystem.symlink((0, node_path_1.relative)(realOriginParent, realVaultPath), originPath, 'dir');
}
async function adoptSkillsIntoVault(input) {
    const filesystem = input.filesystem ?? exports.nativeSkillVaultAdoptFilesystem;
    const copyMode = await (0, skill_vault_index_service_1.detectSkillVaultCopyMode)(input.vaultRoot);
    await filesystem.mkdir(input.vaultRoot);
    // Every origin (primary + merges) stages first; rollback restores by stage
    // or by vault path depending on how far the batch progressed.
    const staged = new Map();
    const movedToVault = new Map(); // originPath -> vaultPath
    const linked = [];
    const rollback = async () => {
        // Reverse order: drop replacement links, move vault copies back, drop stages.
        for (const originPath of linked.toReversed()) {
            await filesystem.remove(originPath).catch(() => undefined);
        }
        for (const [originPath, vaultPath] of [...movedToVault.entries()].toReversed()) {
            await filesystem.rename(vaultPath, originPath).catch(() => undefined);
        }
        for (const [originPath, stagePath] of [...staged.entries()].toReversed()) {
            if (!movedToVault.has(originPath)) {
                await filesystem.rename(stagePath, originPath).catch(() => undefined);
            }
            await filesystem.remove(stagePath).catch(() => undefined);
        }
    };
    try {
        // Phase 1: stage every origin and duplicate so the tree is frozen batch-wide.
        for (const item of input.items) {
            for (const originPath of [item.originPath, ...item.mergePaths]) {
                const stagePath = stagePathFor(originPath);
                await filesystem.rename(originPath, stagePath);
                staged.set(originPath, stagePath);
            }
        }
        // Phase 2: move the primary stages into the vault.
        for (const item of input.items) {
            const stagePath = staged.get(item.originPath);
            if (!stagePath) {
                continue;
            }
            const vaultPath = (0, skill_vault_paths_1.skillVaultEntryRoot)(input.vaultRoot, item.id);
            await filesystem.mkdir((0, node_path_1.dirname)(vaultPath));
            await filesystem.rename(stagePath, vaultPath);
            movedToVault.set(item.originPath, vaultPath);
        }
        // Phase 3: replace every origin with a link (or copy) at the vault primary.
        for (const item of input.items) {
            const vaultPath = (0, skill_vault_paths_1.skillVaultEntryRoot)(input.vaultRoot, item.id);
            for (const originPath of [item.originPath, ...item.mergePaths]) {
                const placeLink = copyMode
                    ? filesystem.copyTree(vaultPath, originPath)
                    : createVaultLink(vaultPath, originPath, filesystem);
                await placeLink;
                linked.push(originPath);
            }
        }
        // Phase 4: write the index last; the filesystem is already the source of truth.
        const previous = await (0, skill_vault_index_service_1.readSkillVaultIndex)(input.indexPath);
        const now = new Date().toISOString();
        const records = [];
        for (const item of input.items) {
            const vaultPath = (0, skill_vault_paths_1.skillVaultEntryRoot)(input.vaultRoot, item.id);
            const markdown = await filesystem.readFile((0, node_path_1.join)(vaultPath, 'SKILL.md')).catch(() => '');
            const summary = (0, skill_metadata_1.summarizeSkillMarkdown)(markdown);
            records.push({
                id: item.id,
                vaultPath,
                originPath: item.originPath,
                mergePaths: [...item.mergePaths],
                digest: await (0, skill_vault_index_service_1.computeSkillVaultDigest)(vaultPath),
                name: summary.name ?? item.id,
                description: summary.description,
                sizeBytes: await (0, skill_vault_index_service_1.skillVaultSizeBytes)(vaultPath).catch(() => 0),
                installedAt: previous?.entries.find((entry) => entry.id === item.id)?.installedAt ?? now
            });
        }
        const retained = (previous?.entries ?? []).filter((entry) => !records.some((record) => record.id === entry.id));
        const entries = [
            ...retained,
            ...records.map((record) => toIndexEntry(record, now, copyMode))
        ].sort((left, right) => left.id.localeCompare(right.id));
        return {
            adopted: records.map((record) => ({
                id: record.id,
                vaultPath: record.vaultPath,
                originPath: record.originPath,
                merged: record.mergePaths
            })),
            copyMode,
            index: await (0, skill_vault_index_service_1.rebuildSkillVaultIndex)(input.indexPath, entries)
        };
    }
    catch (error) {
        await rollback();
        throw error;
    }
}
function toIndexEntry(record, now, copyMode) {
    return {
        id: record.id,
        name: record.name,
        description: record.description,
        sourceKind: 'adopted',
        originPath: record.originPath,
        linkPaths: [record.originPath, ...record.mergePaths],
        digest: record.digest,
        sizeBytes: record.sizeBytes,
        tags: [],
        author: null,
        installedAt: record.installedAt,
        updatedAt: now,
        ...(copyMode ? { copyMode: true } : {})
    };
}
/** Cancel management for one entry: move the primary back and drop its links. */
async function unadoptSkillFromVault(input) {
    const filesystem = input.filesystem ?? exports.nativeSkillVaultAdoptFilesystem;
    const index = await (0, skill_vault_index_service_1.readSkillVaultIndex)(input.indexPath);
    const entry = index?.entries.find((candidate) => candidate.id === input.id);
    if (!entry) {
        throw new Error(`skill-vault-unknown-entry: ${input.id}`);
    }
    const vaultPath = (0, skill_vault_paths_1.skillVaultEntryRoot)(input.vaultRoot, input.id);
    const originPath = entry.originPath ?? (0, node_path_1.join)((0, node_path_1.dirname)(vaultPath), 'restored', input.id);
    // Recorded linkPaths cover every replaced origin (primary + merged copies).
    const linkPaths = [
        ...new Set([originPath, ...(entry.linkPaths ?? []), ...(input.extraLinkPaths ?? [])])
    ];
    const removed = [];
    try {
        await filesystem.mkdir((0, node_path_1.dirname)(originPath));
        for (const linkPath of linkPaths) {
            if ((await filesystem.lstat(linkPath))?.isSymbolicLink()) {
                await filesystem.remove(linkPath);
                removed.push(linkPath);
            }
        }
        await filesystem.rename(vaultPath, originPath);
    }
    catch (error) {
        // Restore links already dropped before the primary move failed.
        for (const linkPath of removed.toReversed()) {
            await createVaultLink(vaultPath, linkPath, filesystem).catch(() => undefined);
        }
        throw error;
    }
    // Merged duplicates were byte-identical; restore them as copies of the
    // returned primary so every pre-adoption location holds the skill again.
    for (const linkPath of removed) {
        if (linkPath === originPath) {
            continue;
        }
        await filesystem.copyTree(originPath, linkPath).catch(() => undefined);
    }
    await (0, skill_vault_index_service_1.rebuildSkillVaultIndex)(input.indexPath, (index?.entries ?? []).filter((candidate) => candidate.id !== input.id));
    return { originPath };
}
