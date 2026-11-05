"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanSkillVault = scanSkillVault;
exports.adoptableSkillVaultItems = adoptableSkillVaultItems;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const skill_state_store_1 = require("../infra/skill-state-store");
const skill_vault_index_service_1 = require("./skill-vault-index-service");
const skill_vault_paths_1 = require("./skill-vault-paths");
function isInsideVault(path, vaultRoot) {
    const normalizedRoot = (0, skill_vault_paths_1.normalizedSkillVaultPath)(vaultRoot);
    const normalizedPath = (0, skill_vault_paths_1.normalizedSkillVaultPath)(path);
    return (normalizedPath === normalizedRoot ||
        normalizedPath.startsWith(`${normalizedRoot}${process.platform === 'win32' ? '\\' : node_path_1.sep}`));
}
async function linkResolvesInsideVault(candidatePath, vaultRoot) {
    // A managed placement is a link whose target resolves inside the vault root.
    const isLink = await (0, promises_1.readlink)(candidatePath)
        .then(() => true)
        .catch(() => false);
    if (!isLink) {
        return false;
    }
    const resolved = await (0, promises_1.realpath)(candidatePath).catch(() => null);
    // macOS temp dirs are themselves symlinks (/tmp -> /private/tmp), so resolve
    // both sides before comparing; a not-yet-created vault root falls back lexical.
    const resolvedRoot = await (0, promises_1.realpath)(vaultRoot).catch(() => vaultRoot);
    return resolved !== null && isInsideVault(resolved, resolvedRoot);
}
/** Group candidates by directory name; each group's verdict is one plan row. */
async function scanSkillVault(input) {
    const observed = [];
    for (const candidatePath of input.candidatePaths) {
        const stats = await (0, promises_1.stat)(candidatePath).catch(() => null);
        const isLinkToVault = await linkResolvesInsideVault(candidatePath, input.vaultRoot);
        const receipt = input.installStateDirectory
            ? await (0, skill_state_store_1.readSkillInstallReceipt)(input.installStateDirectory, candidatePath).catch(() => null)
            : null;
        // Digests are unnecessary for links (content lives in the vault) and receipts.
        const digest = isLinkToVault || receipt
            ? null
            : await (0, skill_vault_index_service_1.computeSkillVaultDigest)(candidatePath).catch(() => null);
        observed.push({
            id: (0, node_path_1.basename)(candidatePath),
            path: candidatePath,
            digest,
            mtimeMs: stats?.mtimeMs ?? null,
            isLinkToVault,
            orcaManaged: receipt !== null
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
        // flatMap maps the null check onto the element type so digest stays `string` downstream.
        const digested = group.flatMap((candidate) => candidate.digest === null ? [] : [{ ...candidate, digest: candidate.digest }]);
        if (digested.length === 0) {
            continue;
        }
        const sorted = [...digested].sort((left, right) => left.path.localeCompare(right.path));
        const distinctDigests = new Set(sorted.map((candidate) => candidate.digest));
        if (distinctDigests.size > 1) {
            // The user edited copies apart; adopt never picks a winner silently (PRD §2.3).
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
            orcaManaged: items.filter((item) => item.disposition === 'orca-managed').length
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
