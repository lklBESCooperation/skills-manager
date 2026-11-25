"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEffectiveSkills = void 0;
exports.planSkillEnablement = planSkillEnablement;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const skill_enablement_1 = require("../contracts/skill-enablement");
Object.defineProperty(exports, "resolveEffectiveSkills", { enumerable: true, get: function () { return skill_enablement_1.resolveEffectiveSkills; } });
const skill_path_containment_1 = require("../contracts/skill-path-containment");
const skill_vault_contract_1 = require("../contracts/skill-vault-contract");
const readonly_root_fence_1 = require("../infra/readonly-root-fence");
const skill_vault_index_service_1 = require("../vault/skill-vault-index-service");
async function observePlacement(skillId, destination) {
    const destinationPath = (0, node_path_1.join)(destination.rootPath, skillId);
    const entryStat = await (0, promises_1.lstat)(destinationPath).catch(() => null);
    if (!entryStat) {
        return {
            skillId,
            provider: destination.provider,
            rootPath: destination.rootPath,
            linkTarget: null,
            exists: false,
            readsCanonicalRoot: destination.readsCanonicalRoot,
            isSymbolicLink: false
        };
    }
    let linkTarget = null;
    const isSym = entryStat.isSymbolicLink();
    if (isSym) {
        const raw = await (0, promises_1.readlink)(destinationPath).catch(() => null);
        if (raw !== null) {
            linkTarget = (0, node_path_1.resolve)(destination.rootPath, raw);
        }
    }
    return {
        skillId,
        provider: destination.provider,
        rootPath: destination.rootPath,
        linkTarget,
        exists: true,
        readsCanonicalRoot: destination.readsCanonicalRoot,
        isSymbolicLink: isSym
    };
}
function isVaultMasterLink(observation, vaultMasterPath) {
    if (!observation.linkTarget) {
        return false;
    }
    return (0, skill_path_containment_1.skillPathsEqual)(observation.linkTarget, vaultMasterPath, (0, skill_path_containment_1.nativeSkillPathSemantics)());
}
/**
 * Vault is the permanent single master (`<vaultRoot>/<skillId>`). Both canonical `.agents/skills`
 * and private provider roots receive symlinks/junctions (or tracked `copyMode` copies) pointing at
 * Vault. Legacy canonical-resident masters emit a one-time `adopt-canonical-to-vault` action.
 */
async function planSkillEnablement(input) {
    const semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)();
    const resolution = (0, skill_enablement_1.resolveEffectiveSkills)({
        installed: input.installedSkillIds,
        userDefaults: input.userDefaults,
        projectOverrides: input.projectOverrides,
        userAgentOverrides: input.userAgentOverrides,
        projectAgentOverrides: input.projectAgentOverrides,
        scope: input.scope ?? 'global'
    });
    const actions = [];
    const conflicts = [];
    const readonlyBlocked = [];
    const masters = await locateSkillMasters(input.installedSkillIds, input.vaultRoot, input.canonicalRoot);
    const indexById = new Map((input.vaultIndex?.entries ?? []).map((entry) => [entry.id, entry]));
    const migratedInPlan = new Set();
    for (const destination of input.destinations) {
        for (const skillId of input.installedSkillIds) {
            const target = resolution.get(skillId);
            if (!target) {
                continue;
            }
            const observation = await observePlacement(skillId, destination);
            const destinationPath = (0, node_path_1.join)(destination.rootPath, skillId);
            if (await (0, readonly_root_fence_1.isReadonlySkillTarget)(destinationPath, {
                readonlyRoots: input.readonlyRoots,
                semantics
            })) {
                readonlyBlocked.push(observation);
                continue;
            }
            const master = masters[skillId];
            const vaultMasterPath = (0, node_path_1.join)(input.vaultRoot, skillId);
            const effectiveForProvider = (0, skill_enablement_1.isSkillEffectiveForAgent)(target, destination.provider);
            // One-time migration when a skill master still sits in canonical without a Vault copy.
            if (destination.readsCanonicalRoot &&
                master?.location === 'canonical' &&
                !migratedInPlan.has(skillId) &&
                observation.exists) {
                migratedInPlan.add(skillId);
                actions.push({ kind: 'adopt-canonical-to-vault', observation });
                if (effectiveForProvider) {
                    actions.push({ kind: 'add', observation, copyMode: input.copyMode });
                }
                continue;
            }
            const linkedToVault = isVaultMasterLink(observation, vaultMasterPath);
            // Handle copyMode placements via 3-way digest protection (Q6).
            if (observation.exists && !observation.isSymbolicLink && input.copyMode) {
                const entry = indexById.get(skillId);
                const placement = entry?.managedPlacements?.[(0, skill_path_containment_1.normalizedSkillPath)(destinationPath, semantics)];
                if (entry && placement?.topology === 'copy') {
                    const observedDigest = await (0, skill_vault_index_service_1.computeSkillVaultDigest)(destinationPath).catch(() => null);
                    const copyState = (0, skill_vault_contract_1.classifyCopyModePlacement)({
                        vaultDigest: entry.digest,
                        observedDigest,
                        placement
                    });
                    if (copyState === 'managed-copy-drifted') {
                        // Drifted local edits are protected; never auto-delete or overwrite!
                        conflicts.push(observation);
                        continue;
                    }
                    if (effectiveForProvider) {
                        actions.push(copyState === 'managed-copy-outdated'
                            ? { kind: 'refresh-copy', observation }
                            : { kind: 'keep', observation });
                    }
                    else {
                        actions.push({ kind: 'remove', observation, copyMode: true });
                    }
                    continue;
                }
            }
            if (observation.exists && !linkedToVault) {
                conflicts.push(observation);
                continue;
            }
            if (effectiveForProvider) {
                actions.push(linkedToVault
                    ? { kind: 'keep', observation }
                    : { kind: 'add', observation, copyMode: input.copyMode });
            }
            else {
                actions.push(linkedToVault
                    ? { kind: 'remove', observation, copyMode: input.copyMode }
                    : { kind: 'keep', observation });
            }
        }
    }
    const counts = {
        add: actions.filter((action) => action.kind === 'add').length,
        remove: actions.filter((action) => action.kind === 'remove').length,
        keep: actions.filter((action) => action.kind === 'keep').length,
        refreshCopy: actions.filter((action) => action.kind === 'refresh-copy').length,
        adoptCanonicalToVault: actions.filter((action) => action.kind === 'adopt-canonical-to-vault')
            .length,
        removeCanonical: actions.filter((action) => action.kind === 'remove' && action.observation.readsCanonicalRoot).length
    };
    return { actions, counts, conflicts, readonlyBlocked, masters };
}
async function locateSkillMasters(skillIds, vaultRoot, canonicalRoot) {
    const masters = {};
    for (const skillId of skillIds) {
        const inVault = await (0, promises_1.lstat)((0, node_path_1.join)(vaultRoot, skillId)).catch(() => null);
        if (inVault) {
            masters[skillId] = { location: 'vault' };
            continue;
        }
        const canonical = canonicalRoot
            ? await (0, promises_1.lstat)((0, node_path_1.join)(canonicalRoot, skillId)).catch(() => null)
            : null;
        masters[skillId] = canonical ? { location: 'canonical' } : { location: 'missing' };
    }
    return masters;
}
