"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSkillVault = scanSkillVault;
exports.adoptableSkillVaultItems = adoptableSkillVaultItems;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const skill_vault_contract_1 = require("../contracts/skill-vault-contract");
const skill_path_containment_1 = require("../contracts/skill-path-containment");
const readonly_root_fence_1 = require("../infra/readonly-root-fence");
const skill_state_store_1 = require("../infra/skill-state-store");
const skill_vault_index_service_1 = require("./skill-vault-index-service");
const skill_vault_paths_1 = require("./skill-vault-paths");
const staging_marker_1 = require("./staging-marker");
function isInsideVault(path, vaultRoot) {
    const normalizedRoot = (0, skill_vault_paths_1.normalizedSkillVaultPath)(vaultRoot);
    const normalizedPath = (0, skill_vault_paths_1.normalizedSkillVaultPath)(path);
    return (normalizedPath === normalizedRoot ||
        normalizedPath.startsWith(`${normalizedRoot}${process.platform === 'win32' ? '\\' : node_path_1.sep}`));
}
async function linkResolvesInsideVault(candidatePath, vaultRoot) {
    // A managed placement is a link whose target resolves inside the vault root.
    const rawTarget = await (0, promises_1.readlink)(candidatePath).catch(() => null);
    if (rawTarget === null) {
        return false;
    }
    const targetExists = await (0, promises_1.stat)(candidatePath)
        .then(() => true)
        .catch(() => false);
    if (!targetExists) {
        return false;
    }
    const resolvedRoot = await (0, promises_1.realpath)(vaultRoot).catch(() => (0, node_path_1.resolve)(vaultRoot));
    const resolved = await (0, promises_1.realpath)(candidatePath).catch(() => null);
    if (resolved !== null && isInsideVault(resolved, resolvedRoot)) {
        return true;
    }
    // Also check immediate link target so a vault entry that itself symlinks to an external repo counts as managed.
    const realParent = await (0, promises_1.realpath)((0, node_path_1.dirname)(candidatePath)).catch(() => (0, node_path_1.resolve)((0, node_path_1.dirname)(candidatePath)));
    const immediateTarget = (0, node_path_1.resolve)(realParent, rawTarget);
    return isInsideVault(immediateTarget, resolvedRoot);
}
/** Group candidates by directory name; each group's verdict is one plan row. */
async function scanSkillVault(input) {
    const semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)();
    const indexById = new Map((input.index?.entries ?? []).map((entry) => [entry.id, entry]));
    const observed = [];
    let skippedReadonly = 0;
    for (const candidatePath of input.candidatePaths) {
        const id = (0, node_path_1.basename)(candidatePath);
        if ((0, staging_marker_1.isSkillStagingEntryName)(id)) {
            continue;
        }
        if (await (0, readonly_root_fence_1.isReadonlySkillTarget)(candidatePath, { readonlyRoots: input.readonlyRoots, semantics })) {
            skippedReadonly += 1;
            continue;
        }
        const [dirStats, skillMdStats] = await Promise.all([
            (0, promises_1.stat)(candidatePath).catch(() => null),
            (0, promises_1.stat)((0, node_path_1.join)(candidatePath, 'SKILL.md')).catch(() => null)
        ]);
        const mtimeMs = skillMdStats?.mtimeMs ?? dirStats?.mtimeMs ?? null;
        const isLinkToVault = await linkResolvesInsideVault(candidatePath, input.vaultRoot);
        const receipt = input.installStateDirectory
            ? await (0, skill_state_store_1.readSkillInstallReceipt)(input.installStateDirectory, candidatePath).catch(() => null)
            : null;
        const indexedEntry = indexById.get(id);
        const placementKey = (0, skill_path_containment_1.normalizedSkillPath)(candidatePath, semantics);
        const placement = indexedEntry?.managedPlacements?.[placementKey];
        // Digests are skipped for vault links and receipts unless needed to classify a copyMode placement.
        const needsDigest = (!isLinkToVault && !receipt) || placement?.topology === 'copy';
        const digest = needsDigest
            ? await (0, skill_vault_index_service_1.computeSkillVaultDigest)(candidatePath).catch(() => null)
            : null;
        let copyState;
        if (placement?.topology === 'copy' && indexedEntry) {
            copyState = (0, skill_vault_contract_1.classifyCopyModePlacement)({
                vaultDigest: indexedEntry.digest,
                observedDigest: digest,
                placement
            });
        }
        observed.push({
            id,
            path: candidatePath,
            digest,
            mtimeMs,
            isLinkToVault,
            orcaManaged: receipt !== null,
            copyState
        });
    }
    const byId = new Map();
    for (const candidate of observed) {
        const group = byId.get(candidate.id) ?? [];
        group.push(candidate);
        byId.set(candidate.id, group);
    }
    const items = [];
    for (const [id, group] of [...byId.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        const drifted = group.find((candidate) => candidate.copyState === 'managed-copy-drifted');
        if (drifted) {
            items.push({
                id,
                disposition: 'copy-drifted',
                originPath: drifted.path,
                digest: drifted.digest ?? '',
                sizeBytes: 0,
                mtimeMs: drifted.mtimeMs,
                mergePaths: [],
                conflicts: [],
                copyModeState: 'managed-copy-drifted'
            });
            continue;
        }
        const outdated = group.find((candidate) => candidate.copyState === 'managed-copy-outdated');
        if (outdated) {
            items.push({
                id,
                disposition: 'copy-outdated',
                originPath: outdated.path,
                digest: outdated.digest ?? '',
                sizeBytes: 0,
                mtimeMs: outdated.mtimeMs,
                mergePaths: [],
                conflicts: [],
                copyModeState: 'managed-copy-outdated'
            });
            continue;
        }
        const managedCopy = group.find((candidate) => candidate.copyState === 'managed-copy-clean');
        if (managedCopy) {
            items.push({
                ...managedItem(id, managedCopy),
                copyModeState: 'managed-copy-clean'
            });
            continue;
        }
        const managed = group.find((candidate) => candidate.isLinkToVault);
        if (managed) {
            items.push(managedItem(id, managed));
            continue;
        }
        const orcaManaged = group.find((candidate) => candidate.orcaManaged);
        if (orcaManaged) {
            items.push(orcaManagedItem(id, orcaManaged));
            continue;
        }
        const digested = group.flatMap((candidate) => candidate.digest === null ? [] : [{ ...candidate, digest: candidate.digest }]);
        if (digested.length === 0) {
            continue;
        }
        const sorted = [...digested].sort((left, right) => left.path.localeCompare(right.path));
        const vaultEntryPath = (0, node_path_1.join)(input.vaultRoot, id);
        const vaultEntryExists = await (0, promises_1.stat)(vaultEntryPath)
            .then((s) => s.isDirectory())
            .catch(() => false);
        if (vaultEntryExists) {
            const vaultDigest = indexById.get(id)?.digest ?? (await (0, skill_vault_index_service_1.computeSkillVaultDigest)(vaultEntryPath).catch(() => null));
            if (vaultDigest !== null) {
                if (sorted.every((candidate) => candidate.digest === vaultDigest)) {
                    items.push(managedItem(id, { ...sorted[0], path: vaultEntryPath }));
                    continue;
                }
                items.push({
                    id,
                    disposition: 'conflict',
                    originPath: sorted[0].path,
                    digest: '',
                    sizeBytes: 0,
                    mtimeMs: sorted[0].mtimeMs,
                    mergePaths: [],
                    conflicts: sorted.map((candidate) => ({
                        id: candidate.id,
                        path: candidate.path,
                        digest: candidate.digest,
                        mtimeMs: candidate.mtimeMs,
                        sizeBytes: 0
                    }))
                });
                continue;
            }
        }
        const distinctDigests = new Set(sorted.map((candidate) => candidate.digest));
        if (distinctDigests.size > 1) {
            items.push({
                id,
                disposition: 'conflict',
                originPath: sorted[0].path,
                digest: '',
                sizeBytes: 0,
                mtimeMs: sorted[0].mtimeMs,
                mergePaths: [],
                conflicts: sorted.map((candidate) => ({
                    id: candidate.id,
                    path: candidate.path,
                    digest: candidate.digest,
                    mtimeMs: candidate.mtimeMs,
                    sizeBytes: 0
                }))
            });
            continue;
        }
        const primary = sorted[0];
        const merges = sorted.slice(1);
        items.push({
            id,
            disposition: 'adoptable',
            originPath: primary.path,
            digest: primary.digest,
            sizeBytes: await (0, skill_vault_index_service_1.skillVaultSizeBytes)(primary.path).catch(() => 0),
            mtimeMs: primary.mtimeMs,
            mergePaths: merges.map((candidate) => candidate.path),
            conflicts: []
        });
    }
    return {
        items,
        counts: {
            managed: items.filter((item) => item.disposition === 'managed').length,
            adoptable: items.filter((item) => item.disposition === 'adoptable').length,
            merged: items.reduce((total, item) => total + item.mergePaths.length, 0),
            conflicts: items.filter((item) => item.disposition === 'conflict').length,
            orcaManaged: items.filter((item) => item.disposition === 'orca-managed').length,
            copyDrifted: items.filter((item) => item.disposition === 'copy-drifted').length,
            copyOutdated: items.filter((item) => item.disposition === 'copy-outdated').length,
            skippedReadonly
        }
    };
}
function managedItem(id, candidate) {
    return {
        id,
        disposition: 'managed',
        originPath: candidate.path,
        digest: '',
        sizeBytes: 0,
        mtimeMs: candidate.mtimeMs,
        mergePaths: [],
        conflicts: []
    };
}
function orcaManagedItem(id, candidate) {
    return {
        id,
        disposition: 'orca-managed',
        originPath: candidate.path,
        digest: '',
        sizeBytes: 0,
        mtimeMs: candidate.mtimeMs,
        mergePaths: [],
        conflicts: []
    };
}
/** Rows an adopt run acts on; conflicts stay out for an explicit user choice. */
function adoptableSkillVaultItems(plan) {
    return plan.items
        .filter((item) => item.disposition === 'adoptable')
        .map((item) => ({
        id: item.id,
        disposition: item.disposition,
        digest: item.digest,
        originPath: item.originPath,
        mergePaths: [...item.mergePaths]
    }));
}
