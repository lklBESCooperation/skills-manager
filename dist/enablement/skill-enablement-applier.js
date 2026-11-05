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
    const canonicalRoot = (0, node_path_1.join)(scopeRoot, '.agents', 'skills');
    // Moves relocate the single master; only legal when vault and canonical share the scope.
    const canonicalMoveAllowed = (0, skill_path_containment_1.skillPathInside)(scopeRoot, runtime.vaultRoot, (0, skill_path_containment_1.nativeSkillPathSemantics)());
    const replayed = await (0, skill_enablement_journal_1.recoverEnablementJournal)(runtime.stateDirectory, runtime.fileIO.readFileBounded);
    const userDefaultsPath = userDefaultsStatePath(runtime.homeDirectory);
    const projectStateFile = runtime.workspaceDirectory === undefined ? null : projectStatePath(runtime.workspaceDirectory);
    const [userDefaultsSalvage, projectStateSalvage, installedSkillIds] = await Promise.all([
        readOptionalFile(userDefaultsPath).then((raw) => (0, skill_enablement_1.parseSkillUserDefaultsFile)(raw, runtime.fileIO.salvage)),
        projectStateFile === null
            ? Promise.resolve((0, skill_enablement_1.parseSkillProjectStateFile)(null, runtime.fileIO.salvage))
            : readOptionalFile(projectStateFile).then((raw) => (0, skill_enablement_1.parseSkillProjectStateFile)(raw, runtime.fileIO.salvage)),
        (0, installed_skill_inventory_1.listInstalledSkillIds)(runtime.vaultRoot, canonicalRoot)
    ]);
    const unknown = input.command.skillIds.filter((id) => !installedSkillIds.includes(id));
    if (unknown.length > 0) {
        throw new Error(`skill-enablement-unknown-skill: ${unknown.join(', ')}. In vault: ${installedSkillIds.join(', ') || '(none)'}`);
    }
    const userDefaults = { ...userDefaultsSalvage.value };
    const projectOverrides = {
        ...projectStateSalvage.value
    };
    const touched = new Set(input.command.skillIds);
    if (input.command.kind === 'inherit') {
        for (const id of touched) {
            delete projectOverrides[id];
        }
        if (projectStateFile !== null) {
            await (0, skill_state_store_1.writeSkillStateFile)(projectStateFile, (0, skill_enablement_1.skillProjectStateFileValue)(projectOverrides));
        }
    }
    else if (input.command.scope === 'user') {
        for (const id of touched) {
            userDefaults[id] = input.command.kind === 'enable' ? 'enabled' : 'disabled';
        }
        await (0, skill_state_store_1.writeSkillStateFile)(userDefaultsPath, (0, skill_enablement_1.skillUserDefaultsFileValue)(userDefaults));
    }
    else {
        for (const id of touched) {
            projectOverrides[id] = input.command.kind === 'enable' ? 'enabled' : 'disabled';
        }
        if (projectStateFile !== null) {
            await (0, skill_state_store_1.writeSkillStateFile)(projectStateFile, (0, skill_enablement_1.skillProjectStateFileValue)(projectOverrides));
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
    const plan = await (0, skill_enablement_planner_1.planSkillEnablement)({
        vaultRoot: runtime.vaultRoot,
        installedSkillIds,
        userDefaults,
        projectOverrides,
        destinations,
        canonicalRoot,
        canonicalMoveAllowed
    });
    const executed = await (0, skill_enablement_journal_1.applyPlanTransactionally)({
        stateDirectory: runtime.stateDirectory,
        plan,
        vaultRoot: runtime.vaultRoot,
        canonicalRoot,
        interruptAfterCount: input.interruptAfterCount
    });
    const conflicts = plan.conflicts.map((observation) => ({
        skillId: observation.skillId,
        provider: observation.provider,
        rootPath: observation.rootPath
    }));
    const changed = executed.length + replayed.executed.length > 0;
    return {
        status: conflicts.length > 0 ? (changed ? 'partial' : 'conflict') : 'applied',
        executed: [...replayed.executed, ...executed],
        conflicts,
        plan,
        resolution: (0, skill_enablement_1.resolveEffectiveSkills)({
            installed: installedSkillIds,
            userDefaults,
            projectOverrides
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
            projectOverrides: projectStateSalvage.value
        }),
        installedSkillIds,
        userDefaults: userDefaultsSalvage.value,
        projectOverrides: projectStateSalvage.value,
        droppedStateKeys: [...userDefaultsSalvage.droppedKeys, ...projectStateSalvage.droppedKeys],
        stateFileUnreadable: userDefaultsSalvage.unreadable || projectStateSalvage.unreadable
    };
}
