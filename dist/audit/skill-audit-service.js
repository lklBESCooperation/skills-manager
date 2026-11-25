"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditSkillsHealth = auditSkillsHealth;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const agent_skill_registry_1 = require("../contracts/agent-skill-registry");
const skill_path_containment_1 = require("../contracts/skill-path-containment");
const readonly_root_fence_1 = require("../infra/readonly-root-fence");
const skill_vault_scan_1 = require("../vault/skill-vault-scan");
const staging_marker_1 = require("../vault/staging-marker");
async function listDirectChildPaths(root) {
    const entries = await (0, promises_1.readdir)(root, { withFileTypes: true }).catch(() => []);
    return entries
        .filter((entry) => !entry.name.startsWith('.') && !(0, staging_marker_1.isSkillStagingEntryName)(entry.name))
        .map((entry) => (0, node_path_1.join)(root, entry.name));
}
function collectScopeAgentRoots(input) {
    const baseDir = input.scope === 'global' ? input.homeDirectory : input.workspaceDirectory;
    if (!baseDir) {
        return [];
    }
    const seen = new Set();
    const roots = [];
    const addRoot = (rootPath, agent) => {
        if (!seen.has(rootPath)) {
            seen.add(rootPath);
            roots.push({ agent, rootPath });
        }
    };
    addRoot((0, node_path_1.join)(baseDir, '.agents', 'skills'));
    for (const descriptor of agent_skill_registry_1.AGENT_SKILL_DESCRIPTORS) {
        if (descriptor.capability === 'unsupported' || descriptor.capability === 'delegate') {
            continue;
        }
        const targetSegs = input.scope === 'global'
            ? descriptor.installTargets.globalSegments
            : descriptor.installTargets.workspaceSegments;
        if (targetSegs) {
            addRoot((0, node_path_1.join)(baseDir, ...targetSegs), descriptor.id);
        }
        const extraSegs = input.scope === 'global'
            ? descriptor.discoveryOnlyRoots?.globalSegments
            : descriptor.discoveryOnlyRoots?.workspaceSegments;
        if (extraSegs) {
            for (const segs of extraSegs) {
                addRoot((0, node_path_1.join)(baseDir, ...segs), descriptor.id);
            }
        }
    }
    return roots;
}
/**
 * Purely read-only health & readonly-plugin diagnostic scanner (HUB-246 item 2 `audit/`).
 * Performs zero filesystem mutations.
 */
async function auditSkillsHealth(input) {
    const semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)();
    const findings = [];
    const roots = collectScopeAgentRoots(input);
    const candidatePaths = [];
    const agentByCandidatePath = new Map();
    for (const { agent, rootPath } of roots) {
        const children = await listDirectChildPaths(rootPath);
        for (const childPath of children) {
            const entryStat = await (0, promises_1.lstat)(childPath).catch(() => null);
            if (!entryStat) {
                continue;
            }
            if (entryStat.isSymbolicLink()) {
                const resolved = await (0, promises_1.stat)(childPath).catch(() => null);
                const rawTarget = await (0, promises_1.readlink)(childPath).catch(() => undefined);
                if (!resolved) {
                    findings.push({
                        kind: 'orphan-symlink',
                        severity: 'warning',
                        skillId: childPath.split(/[/\\]/).at(-1) ?? childPath,
                        path: childPath,
                        ...(agent ? { agent } : {}),
                        ...(rawTarget ? { targetPath: rawTarget } : {}),
                        message: `Broken symlink in agent skill root${rawTarget ? ` (target: ${rawTarget})` : ''}`
                    });
                    continue;
                }
                if (await (0, readonly_root_fence_1.isReadonlySkillTarget)(childPath, {
                    readonlyRoots: input.readonlyRoots,
                    semantics
                })) {
                    const realTarget = await (0, promises_1.realpath)(childPath).catch(() => rawTarget);
                    findings.push({
                        kind: 'readonly-plugin-exposure',
                        severity: 'error',
                        skillId: childPath.split(/[/\\]/).at(-1) ?? childPath,
                        path: childPath,
                        ...(agent ? { agent } : {}),
                        ...(realTarget ? { targetPath: realTarget } : {}),
                        message: 'Symlink in writable agent root resolves into a readonly plugin directory'
                    });
                    continue;
                }
            }
            candidatePaths.push(childPath);
            agentByCandidatePath.set(childPath, agent);
        }
    }
    // Check retired install roots (e.g. ~/.gemini/skills).
    if (input.scope === 'global') {
        for (const descriptor of agent_skill_registry_1.AGENT_SKILL_DESCRIPTORS) {
            for (const retiredSegs of descriptor.retiredInstallRoots ?? []) {
                const retiredRoot = (0, node_path_1.join)(input.homeDirectory, ...retiredSegs);
                const children = await listDirectChildPaths(retiredRoot);
                for (const childPath of children) {
                    findings.push({
                        kind: 'retired-install-root',
                        severity: 'info',
                        skillId: childPath.split(/[/\\]/).at(-1) ?? childPath,
                        path: childPath,
                        agent: descriptor.id,
                        message: `Skill resides in retired root for ${descriptor.displayName}; migrate to canonical .agents/skills`
                    });
                }
            }
        }
    }
    const scanPlan = await (0, skill_vault_scan_1.scanSkillVault)({
        homeDirectory: input.homeDirectory,
        vaultRoot: input.vaultRoot,
        candidatePaths,
        installStateDirectory: input.installStateDirectory,
        index: input.vaultIndex,
        readonlyRoots: input.readonlyRoots
    });
    for (const item of scanPlan.items) {
        if (item.disposition === 'adoptable' && item.mergePaths.length > 0) {
            findings.push({
                kind: 'duplicate-same-digest',
                severity: 'info',
                skillId: item.id,
                path: item.originPath,
                agent: agentByCandidatePath.get(item.originPath),
                message: `${item.mergePaths.length + 1} identical copies found across agent roots`
            });
        }
        else if (item.disposition === 'conflict') {
            findings.push({
                kind: 'digest-conflict',
                severity: 'error',
                skillId: item.id,
                path: item.originPath,
                agent: agentByCandidatePath.get(item.originPath),
                message: `${item.conflicts.length} conflicting variants with differing content digests`
            });
        }
        else if (item.disposition === 'copy-drifted') {
            findings.push({
                kind: 'copy-drifted',
                severity: 'warning',
                skillId: item.id,
                path: item.originPath,
                agent: agentByCandidatePath.get(item.originPath),
                message: 'copyMode placement has local edits differing from Vault master'
            });
        }
        else if (item.disposition === 'copy-outdated') {
            findings.push({
                kind: 'copy-outdated',
                severity: 'info',
                skillId: item.id,
                path: item.originPath,
                agent: agentByCandidatePath.get(item.originPath),
                message: 'copyMode placement is behind Vault master digest and can be refreshed'
            });
        }
    }
    // Audit Vault root itself to confirm zero plugin roots slipped in & detect plugin name collisions.
    const vaultIds = new Set((await listDirectChildPaths(input.vaultRoot)).map((p) => p.split(/[/\\]/).at(-1) ?? p));
    for (const vaultChild of await listDirectChildPaths(input.vaultRoot)) {
        if (await (0, readonly_root_fence_1.isReadonlySkillTarget)(vaultChild, {
            readonlyRoots: input.readonlyRoots,
            semantics
        })) {
            findings.push({
                kind: 'readonly-plugin-exposure',
                severity: 'error',
                skillId: vaultChild.split(/[/\\]/).at(-1) ?? vaultChild,
                path: vaultChild,
                message: 'Vault entry links or resolves to a readonly plugin directory'
            });
        }
    }
    const pluginSkills = input.pluginSkills ?? [];
    for (const pluginSkill of pluginSkills) {
        if (vaultIds.has(pluginSkill.id)) {
            findings.push({
                kind: 'plugin-name-collision',
                severity: 'warning',
                skillId: pluginSkill.id,
                path: pluginSkill.skillDirectoryPath,
                agent: pluginSkill.agent,
                message: `Managed skill '${pluginSkill.id}' shares name with readonly plugin skill '${pluginSkill.pluginName}'`
            });
        }
    }
    return {
        auditedAt: new Date().toISOString(),
        findings,
        summary: {
            totalFindings: findings.length,
            orphanSymlinks: findings.filter((f) => f.kind === 'orphan-symlink').length,
            duplicates: findings.filter((f) => f.kind === 'duplicate-same-digest').length,
            conflicts: findings.filter((f) => f.kind === 'digest-conflict').length,
            copyDrifted: findings.filter((f) => f.kind === 'copy-drifted').length,
            copyOutdated: findings.filter((f) => f.kind === 'copy-outdated').length,
            retiredRoots: findings.filter((f) => f.kind === 'retired-install-root').length,
            readonlyPluginExposures: findings.filter((f) => f.kind === 'readonly-plugin-exposure').length,
            pluginCollisions: findings.filter((f) => f.kind === 'plugin-name-collision').length,
            pluginSkillsTotal: pluginSkills.length,
            pluginSkillsActive: pluginSkills.filter((p) => p.activationState === 'active').length
        }
    };
}
