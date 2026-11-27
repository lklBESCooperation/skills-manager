"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userDefaultsStatePath = userDefaultsStatePath;
exports.enablementVaultRoot = enablementVaultRoot;
exports.projectStatePath = projectStatePath;
exports.runSkillEnablementCommand = runSkillEnablementCommand;
exports.readSkillEnablementState = readSkillEnablementState;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const skill_enablement_1 = require("../contracts/skill-enablement");
const skill_path_containment_1 = require("../contracts/skill-path-containment");
const skill_provider_destinations_1 = require("../infra/skill-provider-destinations");
const skill_state_store_1 = require("../infra/skill-state-store");
const skill_vault_index_service_1 = require("../vault/skill-vault-index-service");
const skill_vault_paths_1 = require("../vault/skill-vault-paths");
const skill_enablement_journal_1 = require("./skill-enablement-journal");
const installed_skill_inventory_1 = require("./installed-skill-inventory");
const skill_enablement_planner_1 = require("./skill-enablement-planner");
function userDefaultsStatePath(homeDirectory) {
    return (0, node_path_1.join)(homeDirectory, skill_enablement_1.SKILL_ENABLEMENT_STATE_DIRNAME, skill_enablement_1.SKILL_USER_DEFAULTS_FILENAME);
}
/** The vault root backing a scope; project scope uses the project vault only when it exists. */
function enablementVaultRoot(input) {
    return input.scope === 'global'
        ? (0, skill_vault_paths_1.userSkillVaultRoot)(input.homeDirectory)
        : (0, skill_vault_paths_1.projectSkillVaultRoot)(input.workspaceDirectory ?? '');
}
function projectStatePath(workspaceDirectory) {
    return (0, node_path_1.join)(workspaceDirectory, skill_enablement_1.SKILL_ENABLEMENT_STATE_DIRNAME, skill_enablement_1.SKILL_PROJECT_STATE_FILENAME);
}
async function readOptionalFile(path) {
    return (0, promises_1.readFile)(path, 'utf8').catch(() => null);
}
async function syncCopyModeIndexPlacements(input) {
    const index = await (0, skill_vault_index_service_1.readSkillVaultIndex)(input.indexPath);
    if (!index) {
        return;
    }
    const semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)();
    const executedKeys = new Set(input.executed.map((step) => `${step.skillId}:${step.provider}`));
    const topology = input.copyMode
        ? 'copy'
        : process.platform === 'win32'
            ? 'junction'
            : 'symlink';
    let dirty = false;
    const nextEntries = [...index.entries];
    for (const action of input.plan.actions) {
        if (action.kind === 'keep' || action.kind === 'adopt-canonical-to-vault') {
            continue;
        }
        const key = `${action.observation.skillId}:${action.observation.provider}`;
        if (!executedKeys.has(key)) {
            continue;
        }
        const entryIndex = nextEntries.findIndex((entry) => entry.id === action.observation.skillId);
        if (entryIndex === -1) {
            continue;
        }
        const entry = nextEntries[entryIndex];
        const placementPath = (0, node_path_1.join)(action.observation.rootPath, action.observation.skillId);
        const placementKey = (0, skill_path_containment_1.normalizedSkillPath)(placementPath, semantics);
        const placements = {
            ...(entry.managedPlacements ?? {})
        };
        if (action.kind === 'remove') {
            if (placementKey in placements) {
                delete placements[placementKey];
                dirty = true;
            }
        }
        else {
            const vaultDigest = await (0, skill_vault_index_service_1.computeSkillVaultDigest)((0, skill_vault_paths_1.skillVaultEntryRoot)(input.vaultRoot, entry.id)).catch(() => entry.digest);
            const destStat = await (0, promises_1.stat)(placementPath).catch(() => null);
            placements[placementKey] = {
                topology,
                syncedDigest: vaultDigest,
                ...(destStat ? { syncedMtimeMs: destStat.mtimeMs } : {})
            };
            dirty = true;
        }
        nextEntries[entryIndex] = {
            ...entry,
            managedPlacements: placements
        };
    }
    if (dirty) {
        await (0, skill_vault_index_service_1.rebuildSkillVaultIndex)(input.indexPath, nextEntries);
    }
}
/**
 * One enablement change = state-file update + plan diff + transactional placement batch.
 * An interrupted previous batch is replayed to convergence before the fresh plan runs.
 */
async function runSkillEnablementCommand(input) {
    const runtime = input.runtime;
    const scopeRoot = runtime.scope === 'global' ? runtime.homeDirectory : runtime.workspaceDirectory;
    if (!scopeRoot) {
        throw new Error('skill-enablement-workspace-required');
    }
    const canonicalRoot = runtime.canonicalRoot === null
        ? undefined
        : (runtime.canonicalRoot ?? (0, node_path_1.join)(scopeRoot, '.agents', 'skills'));
    const replayed = await (0, skill_enablement_journal_1.recoverEnablementJournal)(runtime.stateDirectory, runtime.fileIO.readFileBounded, runtime.readonlyRoots);
    const userDefaultsPath = userDefaultsStatePath(runtime.homeDirectory);
    const projectStateFile = runtime.workspaceDirectory === undefined ? null : projectStatePath(runtime.workspaceDirectory);
    const [userDefaultsSalvage, projectStateSalvage, installedSkillIds, vaultIndex] = await Promise.all([
        readOptionalFile(userDefaultsPath).then((raw) => (0, skill_enablement_1.parseSkillUserDefaultsFile)(raw, runtime.fileIO.salvage)),
        projectStateFile === null
            ? Promise.resolve((0, skill_enablement_1.parseSkillProjectStateFile)(null, runtime.fileIO.salvage))
            : readOptionalFile(projectStateFile).then((raw) => (0, skill_enablement_1.parseSkillProjectStateFile)(raw, runtime.fileIO.salvage)),
        (0, installed_skill_inventory_1.listInstalledSkillIds)(runtime.vaultRoot, canonicalRoot ?? runtime.vaultRoot),
        runtime.indexPath ? (0, skill_vault_index_service_1.readSkillVaultIndex)(runtime.indexPath) : Promise.resolve(null)
    ]);
    const unknown = input.command.skillIds.filter((id) => !installedSkillIds.includes(id));
    if (unknown.length > 0) {
        throw new Error(`skill-enablement-unknown-skill: ${unknown.join(', ')}. In vault: ${installedSkillIds.join(', ') || '(none)'}`);
    }
    const userDefaults = { ...userDefaultsSalvage.value };
    const projectOverrides = { ...projectStateSalvage.value };
    const userAgentOverrides = { ...(userDefaultsSalvage.agentOverrides ?? {}) };
    const projectAgentOverrides = {
        ...(projectStateSalvage.agentOverrides ?? {})
    };
    const touched = new Set(input.command.skillIds);
    if (input.command.kind === 'inherit') {
        for (const id of touched) {
            delete projectOverrides[id];
            delete projectAgentOverrides[id];
        }
        if (projectStateFile !== null) {
            await (0, skill_state_store_1.writeSkillStateFile)(projectStateFile, (0, skill_enablement_1.skillProjectStateFileValue)(projectOverrides, projectAgentOverrides));
        }
    }
    else if (input.command.scope === 'user') {
        for (const id of touched) {
            if (input.command.agents) {
                userAgentOverrides[id] = {
                    ...(userAgentOverrides[id] ?? {}),
                    ...input.command.agents
                };
            }
            else {
                userDefaults[id] = input.command.kind === 'enable' ? 'enabled' : 'disabled';
            }
        }
        await (0, skill_state_store_1.writeSkillStateFile)(userDefaultsPath, (0, skill_enablement_1.skillUserDefaultsFileValue)(userDefaults, userAgentOverrides));
    }
    else {
        for (const id of touched) {
            if (input.command.agents) {
                projectAgentOverrides[id] = {
                    ...(projectAgentOverrides[id] ?? {}),
                    ...input.command.agents
                };
            }
            else {
                projectOverrides[id] = input.command.kind === 'enable' ? 'enabled' : 'disabled';
            }
        }
        if (projectStateFile !== null) {
            await (0, skill_state_store_1.writeSkillStateFile)(projectStateFile, (0, skill_enablement_1.skillProjectStateFileValue)(projectOverrides, projectAgentOverrides));
        }
    }
    const providers = runtime.selectedProviders && runtime.selectedProviders.length > 0
        ? runtime.selectedProviders
        : runtime.detectedProviders;
    const destinations = (0, skill_provider_destinations_1.resolveSkillProviderDestinations)({
        scope: runtime.scope,
        homeDirectory: runtime.homeDirectory,
        ...(runtime.workspaceDirectory ? { workspaceDirectory: runtime.workspaceDirectory } : {}),
        detectedProviders: providers,
        ...(runtime.providerRootOverrides
            ? { providerRootOverrides: runtime.providerRootOverrides }
            : {})
    });
    const copyMode = runtime.copyMode ?? (await (0, skill_vault_index_service_1.detectSkillVaultCopyMode)(runtime.vaultRoot));
    const plan = await (0, skill_enablement_planner_1.planSkillEnablement)({
        vaultRoot: runtime.vaultRoot,
        installedSkillIds,
        userDefaults,
        projectOverrides,
        userAgentOverrides,
        projectAgentOverrides,
        scope: runtime.scope,
        destinations,
        canonicalRoot,
        copyMode,
        vaultIndex,
        readonlyRoots: runtime.readonlyRoots
    });
    const executed = await (0, skill_enablement_journal_1.applyPlanTransactionally)({
        stateDirectory: runtime.stateDirectory,
        plan,
        vaultRoot: runtime.vaultRoot,
        canonicalRoot: canonicalRoot ?? runtime.vaultRoot,
        readonlyRoots: runtime.readonlyRoots,
        interruptAfterCount: input.interruptAfterCount
    });
    if (runtime.indexPath) {
        await syncCopyModeIndexPlacements({
            indexPath: runtime.indexPath,
            vaultRoot: runtime.vaultRoot,
            plan,
            executed,
            copyMode
        });
    }
    const conflicts = plan.conflicts.map((observation) => ({
        skillId: observation.skillId,
        provider: observation.provider,
        rootPath: observation.rootPath
    }));
    const readonlyBlocked = plan.readonlyBlocked.map((observation) => ({
        skillId: observation.skillId,
        provider: observation.provider,
        rootPath: observation.rootPath
    }));
    const changed = executed.length + replayed.executed.length > 0;
    return {
        status: conflicts.length > 0 || readonlyBlocked.length > 0
            ? changed
                ? 'partial'
                : 'conflict'
            : 'applied',
        executed: [...replayed.executed, ...executed],
        conflicts,
        readonlyBlocked,
        plan,
        resolution: (0, skill_enablement_1.resolveEffectiveSkills)({
            installed: installedSkillIds,
            userDefaults,
            projectOverrides,
            userAgentOverrides,
            projectAgentOverrides,
            scope: runtime.scope
        }),
        droppedStateKeys: [...userDefaultsSalvage.droppedKeys, ...projectStateSalvage.droppedKeys],
        stateFileUnreadable: userDefaultsSalvage.unreadable || projectStateSalvage.unreadable
    };
}
/** The read-only view behind `pms skills effective`: resolution plus placement reality. */
async function readSkillEnablementState(input) {
    const runtime = input.runtime;
    const scopeRoot = runtime.scope === 'global' ? runtime.homeDirectory : runtime.workspaceDirectory;
    const canonicalRoot = (0, node_path_1.join)(scopeRoot ?? runtime.homeDirectory, '.agents', 'skills');
    const projectStateFile = runtime.workspaceDirectory === undefined ? null : projectStatePath(runtime.workspaceDirectory);
    const [userDefaultsSalvage, projectStateSalvage, installedSkillIds] = await Promise.all([
        readOptionalFile(userDefaultsStatePath(runtime.homeDirectory)).then((raw) => (0, skill_enablement_1.parseSkillUserDefaultsFile)(raw, runtime.fileIO.salvage)),
        projectStateFile === null
            ? Promise.resolve((0, skill_enablement_1.parseSkillProjectStateFile)(null, runtime.fileIO.salvage))
            : readOptionalFile(projectStateFile).then((raw) => (0, skill_enablement_1.parseSkillProjectStateFile)(raw, runtime.fileIO.salvage)),
        (0, installed_skill_inventory_1.listInstalledSkillIds)(runtime.vaultRoot, canonicalRoot)
    ]);
    return {
        resolution: (0, skill_enablement_1.resolveEffectiveSkills)({
            installed: installedSkillIds,
            userDefaults: userDefaultsSalvage.value,
            projectOverrides: projectStateSalvage.value,
            userAgentOverrides: userDefaultsSalvage.agentOverrides,
            projectAgentOverrides: projectStateSalvage.agentOverrides,
            scope: runtime.scope,
            includeAgents: input.includeAgents
        }),
        installedSkillIds,
        userDefaults: userDefaultsSalvage.value,
        projectOverrides: projectStateSalvage.value,
        ...(userDefaultsSalvage.agentOverrides
            ? { userAgentOverrides: userDefaultsSalvage.agentOverrides }
            : {}),
        ...(projectStateSalvage.agentOverrides
            ? { projectAgentOverrides: projectStateSalvage.agentOverrides }
            : {}),
        droppedStateKeys: [...userDefaultsSalvage.droppedKeys, ...projectStateSalvage.droppedKeys],
        stateFileUnreadable: userDefaultsSalvage.unreadable || projectStateSalvage.unreadable
    };
}
