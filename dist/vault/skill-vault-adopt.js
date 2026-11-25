"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nativeSkillVaultAdoptFilesystem = void 0;
exports.adoptSingleSkillUnit = adoptSingleSkillUnit;
exports.adoptSkillsIntoVault = adoptSkillsIntoVault;
exports.toIndexEntry = toIndexEntry;
exports.promoteCopyModeToVault = promoteCopyModeToVault;
exports.resetCopyModeFromVault = resetCopyModeFromVault;
exports.unadoptSkillFromVault = unadoptSkillFromVault;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const skill_vault_contract_1 = require("../contracts/skill-vault-contract");
const skill_metadata_1 = require("../contracts/skill-metadata");
const skill_path_containment_1 = require("../contracts/skill-path-containment");
const readonly_root_fence_1 = require("../infra/readonly-root-fence");
const skill_filesystem_retry_1 = require("../infra/skill-filesystem-retry");
const staging_marker_1 = require("./staging-marker");
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
/**
 * Single-skill atomic adoption unit: stages, moves primary into Vault, links/copies origins,
 * and rolls back ONLY this skill if any step fails.
 */
async function adoptSingleSkillUnit(input) {
    const filesystem = input.filesystem ?? exports.nativeSkillVaultAdoptFilesystem;
    const semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)();
    const { item } = input;
    const allOrigins = [item.originPath, ...item.mergePaths];
    for (const origin of allOrigins) {
        await (0, readonly_root_fence_1.assertWritableSkillTarget)(origin, { readonlyRoots: input.readonlyRoots, semantics });
    }
    const vaultPath = (0, skill_vault_paths_1.skillVaultEntryRoot)(input.vaultRoot, item.id);
    await (0, readonly_root_fence_1.assertWritableSkillTarget)(vaultPath, { readonlyRoots: input.readonlyRoots, semantics });
    const staged = new Map();
    let movedToVault = false;
    const linked = [];
    const rollback = async () => {
        for (const originPath of linked.toReversed()) {
            await filesystem.remove(originPath).catch(() => undefined);
        }
        if (movedToVault) {
            await filesystem.rename(vaultPath, item.originPath).catch(() => undefined);
        }
        for (const [originPath, stagePath] of [...staged.entries()].toReversed()) {
            if (!(movedToVault && originPath === item.originPath)) {
                await filesystem.rename(stagePath, originPath).catch(() => undefined);
            }
            await filesystem.remove(stagePath).catch(() => undefined);
        }
    };
    try {
        for (const originPath of allOrigins) {
            const stagePath = stagePathFor(originPath);
            await filesystem.rename(originPath, stagePath);
            staged.set(originPath, stagePath);
        }
        const primaryStage = staged.get(item.originPath);
        if (!primaryStage) {
            throw new Error(`skill-vault-missing-stage: ${item.id}`);
        }
        await filesystem.mkdir((0, node_path_1.dirname)(vaultPath));
        await filesystem.rename(primaryStage, vaultPath);
        movedToVault = true;
        for (const originPath of allOrigins) {
            if (input.copyMode) {
                await filesystem.copyTree(vaultPath, originPath);
            }
            else {
                await createVaultLink(vaultPath, originPath, filesystem);
            }
            linked.push(originPath);
        }
        // Clean up duplicate merge staging dirs only after links/copies succeed.
        for (const mergePath of item.mergePaths) {
            const mergeStage = staged.get(mergePath);
            if (mergeStage) {
                await filesystem.remove(mergeStage).catch(() => undefined);
            }
        }
        const markdown = await filesystem.readFile((0, node_path_1.join)(vaultPath, 'SKILL.md')).catch(() => '');
        const summary = (0, skill_metadata_1.summarizeSkillMarkdown)(markdown);
        const digest = await (0, skill_vault_index_service_1.computeSkillVaultDigest)(vaultPath);
        const sizeBytes = await (0, skill_vault_index_service_1.skillVaultSizeBytes)(vaultPath).catch(() => 0);
        const now = new Date().toISOString();
        const managedPlacements = {};
        const topology = input.copyMode
            ? 'copy'
            : process.platform === 'win32'
                ? 'junction'
                : 'symlink';
        for (const originPath of allOrigins) {
            const originStat = await (0, promises_1.stat)(originPath).catch(() => null);
            managedPlacements[(0, skill_path_containment_1.normalizedSkillPath)(originPath, semantics)] = {
                topology,
                syncedDigest: digest,
                ...(originStat ? { syncedMtimeMs: originStat.mtimeMs } : {})
            };
        }
        return {
            id: item.id,
            vaultPath,
            originPath: item.originPath,
            mergePaths: [...item.mergePaths],
            digest,
            name: summary.name ?? item.id,
            description: summary.description,
            sizeBytes,
            installedAt: input.installedAt ?? now,
            managedPlacements
        };
    }
    catch (error) {
        await rollback();
        throw error;
    }
}
/** Batch-atomic adopt (legacy contract preserved: any failure rolls back all items in the batch). */
async function adoptSkillsIntoVault(input) {
    const filesystem = input.filesystem ?? exports.nativeSkillVaultAdoptFilesystem;
    const semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)();
    for (const item of input.items) {
        for (const origin of [item.originPath, ...item.mergePaths]) {
            await (0, readonly_root_fence_1.assertWritableSkillTarget)(origin, { readonlyRoots: input.readonlyRoots, semantics });
        }
    }
    const copyMode = await (0, skill_vault_index_service_1.detectSkillVaultCopyMode)(input.vaultRoot);
    await filesystem.mkdir(input.vaultRoot);
    const staged = new Map();
    const movedToVault = new Map();
    const linked = [];
    const rollback = async () => {
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
        for (const item of input.items) {
            for (const originPath of [item.originPath, ...item.mergePaths]) {
                const stagePath = stagePathFor(originPath);
                await filesystem.rename(originPath, stagePath);
                staged.set(originPath, stagePath);
            }
        }
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
        for (const item of input.items) {
            for (const mergePath of item.mergePaths) {
                const mergeStage = staged.get(mergePath);
                if (mergeStage) {
                    await filesystem.remove(mergeStage).catch(() => undefined);
                }
            }
        }
        const previous = await (0, skill_vault_index_service_1.readSkillVaultIndex)(input.indexPath);
        const now = new Date().toISOString();
        const records = [];
        const topology = copyMode
            ? 'copy'
            : process.platform === 'win32'
                ? 'junction'
                : 'symlink';
        for (const item of input.items) {
            const vaultPath = (0, skill_vault_paths_1.skillVaultEntryRoot)(input.vaultRoot, item.id);
            const markdown = await filesystem.readFile((0, node_path_1.join)(vaultPath, 'SKILL.md')).catch(() => '');
            const summary = (0, skill_metadata_1.summarizeSkillMarkdown)(markdown);
            const digest = await (0, skill_vault_index_service_1.computeSkillVaultDigest)(vaultPath);
            const managedPlacements = {};
            for (const originPath of [item.originPath, ...item.mergePaths]) {
                const originStat = await (0, promises_1.stat)(originPath).catch(() => null);
                managedPlacements[(0, skill_path_containment_1.normalizedSkillPath)(originPath, semantics)] = {
                    topology,
                    syncedDigest: digest,
                    ...(originStat ? { syncedMtimeMs: originStat.mtimeMs } : {})
                };
            }
            records.push({
                id: item.id,
                vaultPath,
                originPath: item.originPath,
                mergePaths: [...item.mergePaths],
                digest,
                name: summary.name ?? item.id,
                description: summary.description,
                sizeBytes: await (0, skill_vault_index_service_1.skillVaultSizeBytes)(vaultPath).catch(() => 0),
                installedAt: previous?.entries.find((entry) => entry.id === item.id)?.installedAt ?? now,
                managedPlacements
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
        ...(copyMode ? { copyMode: true } : {}),
        ...(Object.keys(record.managedPlacements).length > 0
            ? { managedPlacements: record.managedPlacements }
            : {})
    };
}
/** Promote a drifted copyMode placement into Vault (updating Vault master & syncedDigest). */
async function promoteCopyModeToVault(input) {
    const semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)();
    await (0, readonly_root_fence_1.assertWritableSkillTarget)(input.placementPath, {
        readonlyRoots: input.readonlyRoots,
        semantics
    });
    const vaultPath = (0, skill_vault_paths_1.skillVaultEntryRoot)(input.vaultRoot, input.id);
    await (0, readonly_root_fence_1.assertWritableSkillTarget)(vaultPath, { readonlyRoots: input.readonlyRoots, semantics });
    const index = await (0, skill_vault_index_service_1.readSkillVaultIndex)(input.indexPath);
    const entry = index?.entries.find((item) => item.id === input.id);
    if (!entry) {
        throw new Error(`skill-vault-unknown-entry: ${input.id}`);
    }
    const stage = stagePathFor(vaultPath);
    await (0, promises_1.cp)(input.placementPath, stage, { recursive: true, verbatimSymlinks: true });
    const backup = stagePathFor(vaultPath);
    await (0, skill_filesystem_retry_1.renameSkillPathWithWindowsRetry)(vaultPath, backup);
    try {
        await (0, skill_filesystem_retry_1.renameSkillPathWithWindowsRetry)(stage, vaultPath);
        await (0, promises_1.rm)(backup, { recursive: true, force: true }).catch(() => undefined);
    }
    catch (error) {
        await (0, skill_filesystem_retry_1.renameSkillPathWithWindowsRetry)(backup, vaultPath).catch(() => undefined);
        await (0, promises_1.rm)(stage, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }
    const newDigest = await (0, skill_vault_index_service_1.computeSkillVaultDigest)(vaultPath);
    const newSize = await (0, skill_vault_index_service_1.skillVaultSizeBytes)(vaultPath).catch(() => entry.sizeBytes);
    const markdown = await (0, promises_1.readFile)((0, node_path_1.join)(vaultPath, 'SKILL.md'), 'utf8').catch(() => '');
    const summary = (0, skill_metadata_1.summarizeSkillMarkdown)(markdown);
    const placementKey = (0, skill_path_containment_1.normalizedSkillPath)(input.placementPath, semantics);
    const placementStat = await (0, promises_1.stat)(input.placementPath).catch(() => null);
    const updatedEntries = index.entries.map((item) => item.id !== input.id
        ? item
        : {
            ...item,
            name: summary.name ?? item.name,
            description: summary.description,
            digest: newDigest,
            sizeBytes: newSize,
            updatedAt: new Date().toISOString(),
            managedPlacements: {
                ...(item.managedPlacements ?? {}),
                [placementKey]: {
                    topology: 'copy',
                    syncedDigest: newDigest,
                    ...(placementStat ? { syncedMtimeMs: placementStat.mtimeMs } : {})
                }
            }
        });
    return (0, skill_vault_index_service_1.rebuildSkillVaultIndex)(input.indexPath, updatedEntries);
}
/** Reset a drifted/outdated copyMode placement from the authoritative Vault master. */
async function resetCopyModeFromVault(input) {
    const semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)();
    await (0, readonly_root_fence_1.assertWritableSkillTarget)(input.placementPath, {
        readonlyRoots: input.readonlyRoots,
        semantics
    });
    const vaultPath = (0, skill_vault_paths_1.skillVaultEntryRoot)(input.vaultRoot, input.id);
    const index = await (0, skill_vault_index_service_1.readSkillVaultIndex)(input.indexPath);
    const entry = index?.entries.find((item) => item.id === input.id);
    if (!entry) {
        throw new Error(`skill-vault-unknown-entry: ${input.id}`);
    }
    const stage = stagePathFor(input.placementPath);
    await (0, promises_1.cp)(vaultPath, stage, { recursive: true, verbatimSymlinks: true });
    await (0, promises_1.rm)(input.placementPath, { recursive: true, force: true });
    await (0, skill_filesystem_retry_1.renameSkillPathWithWindowsRetry)(stage, input.placementPath);
    const vaultDigest = await (0, skill_vault_index_service_1.computeSkillVaultDigest)(vaultPath);
    const placementKey = (0, skill_path_containment_1.normalizedSkillPath)(input.placementPath, semantics);
    const placementStat = await (0, promises_1.stat)(input.placementPath).catch(() => null);
    const updatedEntries = index.entries.map((item) => item.id !== input.id
        ? item
        : {
            ...item,
            digest: vaultDigest,
            updatedAt: new Date().toISOString(),
            managedPlacements: {
                ...(item.managedPlacements ?? {}),
                [placementKey]: {
                    topology: 'copy',
                    syncedDigest: vaultDigest,
                    ...(placementStat ? { syncedMtimeMs: placementStat.mtimeMs } : {})
                }
            }
        });
    return (0, skill_vault_index_service_1.rebuildSkillVaultIndex)(input.indexPath, updatedEntries);
}
/** Cancel management for one entry: move the primary back and drop its links. */
async function unadoptSkillFromVault(input) {
    const filesystem = input.filesystem ?? exports.nativeSkillVaultAdoptFilesystem;
    const semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)();
    const index = await (0, skill_vault_index_service_1.readSkillVaultIndex)(input.indexPath);
    const entry = index?.entries.find((candidate) => candidate.id === input.id);
    if (!entry) {
        throw new Error(`skill-vault-unknown-entry: ${input.id}`);
    }
    const vaultPath = (0, skill_vault_paths_1.skillVaultEntryRoot)(input.vaultRoot, input.id);
    const originPath = entry.originPath ?? (0, node_path_1.join)((0, node_path_1.dirname)(vaultPath), 'restored', input.id);
    await (0, readonly_root_fence_1.assertWritableSkillTarget)(originPath, { readonlyRoots: input.readonlyRoots, semantics });
    const linkPaths = [
        ...new Set([originPath, ...(entry.linkPaths ?? []), ...(input.extraLinkPaths ?? [])])
    ];
    for (const linkPath of linkPaths) {
        await (0, readonly_root_fence_1.assertWritableSkillTarget)(linkPath, { readonlyRoots: input.readonlyRoots, semantics });
    }
    const removed = [];
    try {
        await filesystem.mkdir((0, node_path_1.dirname)(originPath));
        for (const linkPath of linkPaths) {
            const linkStat = await filesystem.lstat(linkPath);
            if (!linkStat) {
                continue;
            }
            if (linkStat.isSymbolicLink()) {
                await filesystem.remove(linkPath);
                removed.push(linkPath);
                continue;
            }
            // In copyMode, protect drifted local edits unless explicitly forced.
            const placement = entry.managedPlacements?.[(0, skill_path_containment_1.normalizedSkillPath)(linkPath, semantics)];
            if (placement?.topology === 'copy') {
                const observedDigest = await (0, skill_vault_index_service_1.computeSkillVaultDigest)(linkPath).catch(() => null);
                const state = (0, skill_vault_contract_1.classifyCopyModePlacement)({
                    vaultDigest: entry.digest,
                    observedDigest,
                    placement
                });
                if (state === 'managed-copy-drifted' && !input.force) {
                    throw new Error(`skill-copy-mode-drifted: ${linkPath}`);
                }
                await filesystem.remove(linkPath);
                removed.push(linkPath);
            }
        }
        await filesystem.rename(vaultPath, originPath);
    }
    catch (error) {
        for (const linkPath of removed.toReversed()) {
            await createVaultLink(vaultPath, linkPath, filesystem).catch(() => undefined);
        }
        throw error;
    }
    for (const linkPath of removed) {
        if (linkPath === originPath) {
            continue;
        }
        await filesystem.copyTree(originPath, linkPath).catch(() => undefined);
    }
    await (0, skill_vault_index_service_1.rebuildSkillVaultIndex)(input.indexPath, (index?.entries ?? []).filter((candidate) => candidate.id !== input.id));
    return { originPath };
}
