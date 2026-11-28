import { lstat, readdir, readlink, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { AGENT_SKILL_DESCRIPTORS } from '../contracts/agent-skill-registry'
import type { PluginSkillRecord } from '../contracts/plugin-skill-contract'
import type { SkillAuditFinding, SkillAuditReport } from '../contracts/skill-audit-contract'
import { nativeSkillPathSemantics } from '../contracts/skill-path-containment'
import type { SkillVaultIndex } from '../contracts/skill-vault-contract'
import type { TuiAgent } from '../contracts/tui-agent'
import { isReadonlySkillTarget } from '../infra/readonly-root-fence'
import { scanSkillVault } from '../vault/skill-vault-scan'
import { isSkillStagingEntryName } from '../vault/staging-marker'

export type SkillAuditInput = {
  scope: 'global' | 'workspace'
  homeDirectory: string
  workspaceDirectory?: string
  vaultRoot: string
  vaultIndex?: SkillVaultIndex | null
  pluginSkills?: readonly PluginSkillRecord[]
  readonlyRoots?: readonly string[]
  installStateDirectory?: string
}

function quoteShellArg(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}

async function listDirectChildPaths(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => !entry.name.startsWith('.') && !isSkillStagingEntryName(entry.name))
    .map((entry) => join(root, entry.name))
}

function collectScopeAgentRoots(input: SkillAuditInput): { agent?: TuiAgent; rootPath: string }[] {
  const baseDir = input.scope === 'global' ? input.homeDirectory : input.workspaceDirectory
  if (!baseDir) {
    return []
  }
  const seen = new Set<string>()
  const roots: { agent?: TuiAgent; rootPath: string }[] = []

  const addRoot = (rootPath: string, agent?: TuiAgent): void => {
    if (!seen.has(rootPath)) {
      seen.add(rootPath)
      roots.push({ agent, rootPath })
    }
  }

  addRoot(join(baseDir, '.agents', 'skills'))

  for (const descriptor of AGENT_SKILL_DESCRIPTORS) {
    if (descriptor.capability === 'unsupported' || descriptor.capability === 'delegate') {
      continue
    }
    const targetSegs =
      input.scope === 'global'
        ? descriptor.installTargets.globalSegments
        : descriptor.installTargets.workspaceSegments
    if (targetSegs) {
      addRoot(join(baseDir, ...targetSegs), descriptor.id)
    }
    const extraSegs =
      input.scope === 'global'
        ? descriptor.discoveryOnlyRoots?.globalSegments
        : descriptor.discoveryOnlyRoots?.workspaceSegments
    if (extraSegs) {
      for (const segs of extraSegs) {
        addRoot(join(baseDir, ...segs), descriptor.id)
      }
    }
  }
  return roots
}

/**
 * Purely read-only health & readonly-plugin diagnostic scanner (HUB-246 item 2 `audit/`).
 * Performs zero filesystem mutations.
 */
export async function auditSkillsHealth(input: SkillAuditInput): Promise<SkillAuditReport> {
  const semantics = nativeSkillPathSemantics()
  const findings: SkillAuditFinding[] = []
  const roots = collectScopeAgentRoots(input)
  const candidatePaths: string[] = []
  const agentByCandidatePath = new Map<string, TuiAgent | undefined>()

  for (const { agent, rootPath } of roots) {
    const children = await listDirectChildPaths(rootPath)
    for (const childPath of children) {
      const entryStat = await lstat(childPath).catch(() => null)
      if (!entryStat) {
        continue
      }
      if (entryStat.isSymbolicLink()) {
        const resolved = await stat(childPath).catch(() => null)
        const rawTarget = await readlink(childPath).catch(() => undefined)
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
          })
          continue
        }
        if (
          await isReadonlySkillTarget(childPath, {
            readonlyRoots: input.readonlyRoots,
            semantics
          })
        ) {
          const realTarget = await realpath(childPath).catch(() => rawTarget)
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
          })
          continue
        }
      }
      candidatePaths.push(childPath)
      agentByCandidatePath.set(childPath, agent)
    }
  }

  // Check retired install roots (e.g. ~/.gemini/skills).
  if (input.scope === 'global') {
    for (const descriptor of AGENT_SKILL_DESCRIPTORS) {
      for (const retiredSegs of descriptor.retiredInstallRoots ?? []) {
        const retiredRoot = join(input.homeDirectory, ...retiredSegs)
        const children = await listDirectChildPaths(retiredRoot)
        for (const childPath of children) {
          const skillId = childPath.split(/[/\\]/).at(-1) ?? childPath
          const canonicalRoot = join(input.homeDirectory, '.agents', 'skills')
          findings.push({
            kind: 'retired-install-root',
            severity: 'info',
            skillId,
            path: childPath,
            agent: descriptor.id,
            message: `Skill resides in retired root for ${descriptor.displayName}; migrate to canonical .agents/skills`,
            suggestedCommand: `mkdir -p ${quoteShellArg(canonicalRoot)} && mv ${quoteShellArg(childPath)} ${quoteShellArg(join(canonicalRoot, skillId))}`,
            actionHint: '将该技能迁移至共享目录 .agents/skills，再回到工作台执行纳管'
          })
        }
      }
    }
  }

  const scanPlan = await scanSkillVault({
    homeDirectory: input.homeDirectory,
    vaultRoot: input.vaultRoot,
    candidatePaths,
    installStateDirectory: input.installStateDirectory,
    index: input.vaultIndex,
    readonlyRoots: input.readonlyRoots
  })

  for (const item of scanPlan.items) {
    const candidateAgent = agentByCandidatePath.get(item.originPath)
    if (item.disposition === 'adoptable' && item.mergePaths.length > 0) {
      const copyPaths = [item.originPath, ...item.mergePaths]
      findings.push({
        kind: 'duplicate-same-digest',
        severity: 'info',
        skillId: item.id,
        path: item.originPath,
        ...(candidateAgent ? { agent: candidateAgent } : {}),
        message: `${item.mergePaths.length + 1} identical copies found across agent roots`,
        suggestedCommand: `ls -ld ${copyPaths.map(quoteShellArg).join(' ')}`,
        actionHint: '多个目录存在内容相同的副本，可在「已安装技能」页签执行纳管自动合并为链接'
      })
    } else if (item.disposition === 'conflict') {
      const conflictCmd =
        item.conflicts.length >= 2
          ? `diff -ru ${quoteShellArg(item.conflicts[0].path)} ${quoteShellArg(item.conflicts[1].path)}`
          : `ls -ld ${quoteShellArg(item.originPath)}`
      findings.push({
        kind: 'digest-conflict',
        severity: 'error',
        skillId: item.id,
        path: item.originPath,
        ...(candidateAgent ? { agent: candidateAgent } : {}),
        message: `${item.conflicts.length} conflicting variants with differing content digests`,
        suggestedCommand: conflictCmd,
        actionHint: '同名技能在不同目录存在内容差异，请对比后保留所需版本并清理其余副本'
      })
    } else if (item.disposition === 'copy-drifted') {
      findings.push({
        kind: 'copy-drifted',
        severity: 'warning',
        skillId: item.id,
        path: item.originPath,
        ...(candidateAgent ? { agent: candidateAgent } : {}),
        message: 'copyMode placement has local edits differing from Vault master',
        suggestedCommand: `diff -ru ${quoteShellArg(join(input.vaultRoot, item.id))} ${quoteShellArg(item.originPath)}`,
        actionHint: 'Copy 模式本地副本与 Vault 主版本存在差异，请对比后决定同步回 Vault 或重置副本'
      })
    } else if (item.disposition === 'copy-outdated') {
      findings.push({
        kind: 'copy-outdated',
        severity: 'info',
        skillId: item.id,
        path: item.originPath,
        ...(candidateAgent ? { agent: candidateAgent } : {}),
        message: 'copyMode placement is behind Vault master digest and can be refreshed',
        suggestedCommand: `diff -ru ${quoteShellArg(join(input.vaultRoot, item.id))} ${quoteShellArg(item.originPath)}`,
        actionHint: 'Copy 模式本地副本版本落后于 Vault，可通过重新启用技能刷新同步'
      })
    }
  }

  // Audit Vault root itself to confirm zero plugin roots slipped in & detect plugin name collisions.
  const vaultIds = new Set((await listDirectChildPaths(input.vaultRoot)).map((p) => p.split(/[/\\]/).at(-1) ?? p))
  for (const vaultChild of await listDirectChildPaths(input.vaultRoot)) {
    if (
      await isReadonlySkillTarget(vaultChild, {
        readonlyRoots: input.readonlyRoots,
        semantics
      })
    ) {
      const vaultChildIsSymlink = await lstat(vaultChild)
        .then((s) => s.isSymbolicLink())
        .catch(() => false)
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
      })
    }
  }

  const pluginSkills = input.pluginSkills ?? []
  for (const pluginSkill of pluginSkills) {
    if (vaultIds.has(pluginSkill.id)) {
      findings.push({
        kind: 'plugin-name-collision',
        severity: 'warning',
        skillId: pluginSkill.id,
        path: pluginSkill.skillDirectoryPath,
        ...(pluginSkill.agent ? { agent: pluginSkill.agent } : {}),
        message: `Managed skill '${pluginSkill.id}' shares name with readonly plugin skill '${pluginSkill.pluginName}'`,
        suggestedCommand: `ls -ld ${quoteShellArg(join(input.vaultRoot, pluginSkill.id))} ${quoteShellArg(pluginSkill.skillDirectoryPath)}`,
        actionHint: '受管技能与只读插件内置技能同名，建议停用或重命名受管副本以避免覆盖冲突'
      })
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
  }
}
