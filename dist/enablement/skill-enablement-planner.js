"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEffectiveSkills = void 0;
exports.planSkillEnablement = planSkillEnablement;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const skill_enablement_1 = require("../contracts/skill-enablement");
Object.defineProperty(exports, "resolveEffectiveSkills", { enumerable: true, get: function () { return skill_enablement_1.resolveEffectiveSkills; } });
const skill_path_containment_1 = require("../contracts/skill-path-containment");
/** lstat semantics: a link that points anywhere still reports as a link; resolve for target compare. */
async function observePlacement(skillId, destination) {
    const destinationPath = (0, node_path_1.join)(destination.rootPath, skillId);
    const stat = await (0, promises_1.lstat)(destinationPath).catch(() => null);
    if (!stat) {
        return {
            skillId,
            provider: destination.provider,
            rootPath: destination.rootPath,
            linkTarget: null,
            exists: false,
            readsCanonicalRoot: destination.readsCanonicalRoot
        };
    }
    let linkTarget = null;
    if (stat.isSymbolicLink()) {
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
        readsCanonicalRoot: destination.readsCanonicalRoot
    };
}
function isMasterLink(observation, masterPath) {
    if (!observation.linkTarget) {
        return false;
    }
    return (0, skill_path_containment_1.skillPathsEqual)(observation.linkTarget, masterPath, (0, skill_path_containment_1.nativeSkillPathSemantics)());
}
/**
 * Diff actual per-provider placement against the resolved target. Non-canonical roots plan a
 * link (add), unlink (remove), or keep; canonical-root providers plan a master move instead.
 */
async function planSkillEnablement(input) {
    const resolution = (0, skill_enablement_1.resolveEffectiveSkills)({
        installed: input.installedSkillIds,
        userDefaults: input.userDefaults,
        projectOverrides: input.projectOverrides
    });
    const actions = [];
    const conflicts = [];
    const masters = await locateSkillMasters(input.installedSkillIds, input.vaultRoot, input.canonicalRoot);
    for (const destination of input.destinations) {
        for (const skillId of input.installedSkillIds) {
            const target = resolution.get(skillId);
            if (!target) {
                continue;
            }
            const observation = await observePlacement(skillId, destination);
            if (destination.readsCanonicalRoot && input.canonicalMoveAllowed) {
                // Canonical holds masters for this provider; enable=master present, disable=absent.
                const canonicalEnabled = observation.exists;
                if (target.effective === 'enabled') {
                    actions.push(canonicalEnabled
                        ? { kind: 'keep', observation }
                        : { kind: 'move-to-canonical', observation });
                }
                else if (canonicalEnabled) {
                    actions.push({ kind: 'remove', observation });
                }
                else {
                    actions.push({ kind: 'keep', observation });
                }
                continue;
            }
            // Compare against the master's real current location so a valid link is never
            // misread as foreign after a canonical provider moved it out of the vault.
            const linked = isMasterLink(observation, masterLinkTarget(input, skillId, masters));
            if (observation.exists && !linked) {
                // A foreign directory/file owns the name; never delete or overwrite it.
                conflicts.push(observation);
                continue;
            }
            if (target.effective === 'enabled') {
                actions.push(linked ? { kind: 'keep', observation } : { kind: 'add', observation });
            }
            else {
                actions.push(linked ? { kind: 'remove', observation } : { kind: 'keep', observation });
            }
        }
    }
    const counts = {
        add: actions.filter((action) => action.kind === 'add').length,
        remove: actions.filter((action) => action.kind === 'remove').length,
        keep: actions.filter((action) => action.kind === 'keep').length,
        moveToCanonical: actions.filter((action) => action.kind === 'move-to-canonical').length,
        removeCanonical: actions.filter((action) => action.kind === 'remove' && action.observation.readsCanonicalRoot).length
    };
    return { actions, counts, conflicts, masters };
}
/** The link for a non-canonical provider must follow the master wherever it currently lives. */
function masterLinkTarget(input, skillId, masters) {
    const master = masters[skillId];
    if (master?.location === 'canonical' && input.canonicalRoot) {
        return (0, node_path_1.join)(input.canonicalRoot, skillId);
    }
    return (0, node_path_1.join)(input.vaultRoot, skillId);
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
