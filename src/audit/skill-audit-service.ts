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
            message: `Broken symlink in agent skill root${rawTarget ? ` (target: ${rawTarget})` : ''}`
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
            message: 'Symlink in writable agent root resolves into a readonly plugin directory'
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
          findings.push({
            kind: 'retired-install-root',
            severity: 'info',
            skillId: childPath.split(/[/\\]/).at(-1) ?? childPath,
            path: childPath,
            agent: descriptor.id,
            message: `Skill resides in retired root for ${descriptor.displayName}; migrate to canonical .agents/skills`
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
    if (item.disposition === 'adoptable' && item.mergePaths.length > 0) {
      findings.push({
        kind: 'duplicate-same-digest',
        severity: 'info',
        skillId: item.id,
        path: item.originPath,
        agent: agentByCandidatePath.get(item.originPath),
        message: `${item.mergePaths.length + 1} identical copies found across agent roots`
      })
    } else if (item.disposition === 'conflict') {
      findings.push({
        kind: 'digest-conflict',
        severity: 'error',
        skillId: item.id,
        path: item.originPath,
        agent: agentByCandidatePath.get(item.originPath),
        message: `${item.conflicts.length} conflicting variants with differing content digests`
      })
    } else if (item.disposition === 'copy-drifted') {
      findings.push({
        kind: 'copy-drifted',
        severity: 'warning',
        skillId: item.id,
        path: item.originPath,
        agent: agentByCandidatePath.get(item.originPath),
        message: 'copyMode placement has local edits differing from Vault master'
      })
    } else if (item.disposition === 'copy-outdated') {
      findings.push({
        kind: 'copy-outdated',
        severity: 'info',
        skillId: item.id,
        path: item.originPath,
        agent: agentByCandidatePath.get(item.originPath),
        message: 'copyMode placement is behind Vault master digest and can be refreshed'
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
      findings.push({
        kind: 'readonly-plugin-exposure',
        severity: 'error',
        skillId: vaultChild.split(/[/\\]/).at(-1) ?? vaultChild,
        path: vaultChild,
        message: 'Vault entry links or resolves to a readonly plugin directory'
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
        agent: pluginSkill.agent,
        message: `Managed skill '${pluginSkill.id}' shares name with readonly plugin skill '${pluginSkill.pluginName}'`
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
