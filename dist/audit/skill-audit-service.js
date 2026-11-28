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
function quoteShellArg(value) {
    return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}
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
                        message: `Broken symlink in agent skill root${rawTarget ? ` (target: ${rawTarget})` : ''}`,
                        suggestedCommand: `rm ${quoteShellArg(childPath)}`,
                        actionHint: '清理失效的断链符号链接（或在对应位置恢复目标目录）',
                        fixable: true
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
                        message: 'Symlink in writable agent root resolves into a readonly plugin directory',
                        suggestedCommand: `rm ${quoteShellArg(childPath)}`,
                        actionHint: '移除指向只读插件目录的符号链接，避免误修改插件内置技能',
                        fixable: true
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
                    const skillId = childPath.split(/[/\\]/).at(-1) ?? childPath;
                    const canonicalRoot = (0, node_path_1.join)(input.homeDirectory, '.agents', 'skills');
                    findings.push({
                        kind: 'retired-install-root',
                        severity: 'info',
                        skillId,
                        path: childPath,
                        agent: descriptor.id,
                        message: `Skill resides in retired root for ${descriptor.displayName}; migrate to canonical .agents/skills`,
                        suggestedCommand: `mkdir -p ${quoteShellArg(canonicalRoot)} && mv ${quoteShellArg(childPath)} ${quoteShellArg((0, node_path_1.join)(canonicalRoot, skillId))}`,
                        actionHint: '将该技能迁移至共享目录 .agents/skills，再回到工作台执行纳管'
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
        const candidateAgent = agentByCandidatePath.get(item.originPath);
        if (item.disposition === 'adoptable' && item.mergePaths.length > 0) {
            const copyPaths = [item.originPath, ...item.mergePaths];
            findings.push({
                kind: 'duplicate-same-digest',
                severity: 'info',
                skillId: item.id,
                path: item.originPath,
                ...(candidateAgent ? { agent: candidateAgent } : {}),
                message: `${item.mergePaths.length + 1} identical copies found across agent roots`,
                suggestedCommand: `ls -ld ${copyPaths.map(quoteShellArg).join(' ')}`,
                actionHint: '多个目录存在内容相同的副本，可在「已安装技能」页签执行纳管自动合并为链接'
            });
        }
        else if (item.disposition === 'conflict') {
            const conflictCmd = item.conflicts.length >= 2
                ? `diff -ru ${quoteShellArg(item.conflicts[0].path)} ${quoteShellArg(item.conflicts[1].path)}`
                : `ls -ld ${quoteShellArg(item.originPath)}`;
            findings.push({
                kind: 'digest-conflict',
                severity: 'error',
                skillId: item.id,
                path: item.originPath,
                ...(candidateAgent ? { agent: candidateAgent } : {}),
                message: `${item.conflicts.length} conflicting variants with differing content digests`,
                suggestedCommand: conflictCmd,
                actionHint: '同名技能在不同目录存在内容差异，请对比后保留所需版本并清理其余副本'
            });
        }
        else if (item.disposition === 'copy-drifted') {
            findings.push({
                kind: 'copy-drifted',
                severity: 'warning',
                skillId: item.id,
                path: item.originPath,
                ...(candidateAgent ? { agent: candidateAgent } : {}),
                message: 'copyMode placement has local edits differing from Vault master',
                suggestedCommand: `diff -ru ${quoteShellArg((0, node_path_1.join)(input.vaultRoot, item.id))} ${quoteShellArg(item.originPath)}`,
                actionHint: 'Copy 模式本地副本与 Vault 主版本存在差异，请对比后决定同步回 Vault 或重置副本'
            });
        }
        else if (item.disposition === 'copy-outdated') {
            findings.push({
                kind: 'copy-outdated',
                severity: 'info',
                skillId: item.id,
                path: item.originPath,
                ...(candidateAgent ? { agent: candidateAgent } : {}),
                message: 'copyMode placement is behind Vault master digest and can be refreshed',
                suggestedCommand: `diff -ru ${quoteShellArg((0, node_path_1.join)(input.vaultRoot, item.id))} ${quoteShellArg(item.originPath)}`,
                actionHint: 'Copy 模式本地副本版本落后于 Vault，可通过重新启用技能刷新同步'
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
            const vaultChildIsSymlink = await (0, promises_1.lstat)(vaultChild)
                .then((s) => s.isSymbolicLink())
                .catch(() => false);
            findings.push({
                kind: 'readonly-plugin-exposure',
                severity: 'error',
                skillId: vaultChild.split(/[/\\]/).at(-1) ?? vaultChild,
                path: vaultChild,
                message: 'Vault entry links or resolves to a readonly plugin directory',
                suggestedCommand: vaultChildIsSymlink
                    ? `rm ${quoteShellArg(vaultChild)}`
                    : `rm -rf ${quoteShellArg(vaultChild)}`,
                actionHint: '移除指向只读插件目录的链接或副本，避免误修改插件内置技能',
                ...(vaultChildIsSymlink ? { fixable: true } : {})
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
                ...(pluginSkill.agent ? { agent: pluginSkill.agent } : {}),
                message: `Managed skill '${pluginSkill.id}' shares name with readonly plugin skill '${pluginSkill.pluginName}'`,
                suggestedCommand: `ls -ld ${quoteShellArg((0, node_path_1.join)(input.vaultRoot, pluginSkill.id))} ${quoteShellArg(pluginSkill.skillDirectoryPath)}`,
                actionHint: '受管技能与只读插件内置技能同名，建议停用或重命名受管副本以避免覆盖冲突'
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
