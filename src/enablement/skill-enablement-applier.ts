import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseSkillProjectStateFile,
  parseSkillUserDefaultsFile,
  resolveEffectiveSkills,
  skillProjectStateFileValue,
  skillUserDefaultsFileValue,
  SKILL_PROJECT_STATE_FILENAME,
  SKILL_USER_DEFAULTS_FILENAME,
  SKILL_ENABLEMENT_STATE_DIRNAME,
  type AgentId,
  type EffectiveSkillResolution,
  type SkillAgentOverrides,
  type SkillEnablementSalvage,
  type SkillProjectOverrides,
  type SkillUserDefaults
} from '../contracts/skill-enablement'
import { nativeSkillPathSemantics, normalizedSkillPath } from '../contracts/skill-path-containment'
import type { ManagedPlacementRecord } from '../contracts/skill-vault-contract'
import {
  resolveSkillProviderDestinations,
  type SkillProviderDestination,
  type SkillProviderRootOverrides
} from '../infra/skill-provider-destinations'
import { writeSkillStateFile } from '../infra/skill-state-store'
import {
  computeSkillVaultDigest,
  detectSkillVaultCopyMode,
  readSkillVaultIndex,
  rebuildSkillVaultIndex
} from '../vault/skill-vault-index-service'
import {
  projectSkillVaultRoot,
  skillVaultEntryRoot,
  userSkillVaultRoot
} from '../vault/skill-vault-paths'
import {
  applyPlanTransactionally,
  recoverEnablementJournal,
  type EnablementBoundedFileReader,
  type ExecutedEnablementStep
} from './skill-enablement-journal'
import { listInstalledSkillIds } from './installed-skill-inventory'
import { planSkillEnablement, type SkillEnablementPlan } from './skill-enablement-planner'

export type SkillEnablementScope = 'global' | 'workspace'

/** Host-injected file IO: zod salvage for state parsing, bounded reads for journal recovery. */
export type SkillEnablementFileIO = {
  salvage: SkillEnablementSalvage
  readFileBounded: EnablementBoundedFileReader
}

export type SkillEnablementCommand =
  | {
      kind: 'enable' | 'disable'
      skillIds: readonly string[]
      scope: 'user' | 'project'
      /** Optional per-agent overrides (`agents?: Record<AgentId, boolean>`) applied to each listed skill. */
      agents?: Partial<Record<AgentId, boolean>>
    }
  /** Project-level only: delete the override key and re-place from the resolution. */
  | { kind: 'inherit'; skillIds: readonly string[] }

export type SkillEnablementRuntimeInput = {
  scope: SkillEnablementScope
  homeDirectory: string
  workspaceDirectory?: string
  /** Injected vault root; P1 owns the real layout (`~/.pmstudio/skills`), tests build fakes. */
  vaultRoot: string
  /** Optional vault index path; when supplied, tracks copyMode `managedPlacements`. */
  indexPath?: string
  /** Journal location for the placement batch; defaults beside the state files. */
  stateDirectory: string
  detectedProviders: readonly string[]
  selectedProviders?: readonly string[]
  providerRootOverrides?: SkillProviderRootOverrides
  readonlyRoots?: readonly string[]
  copyMode?: boolean
  /** Optional override for canonical root lookup; `null` restricts inventory to `vaultRoot` only. */
  canonicalRoot?: string | null
  /** Host-injected file IO; the CLI entry binds the app's shared implementations. */
  fileIO: SkillEnablementFileIO
}

export type SkillEnablementResult = {
  status: 'applied' | 'conflict' | 'partial'
  executed: ExecutedEnablementStep[]
  conflicts: { skillId: string; provider: string; rootPath: string }[]
  readonlyBlocked: { skillId: string; provider: string; rootPath: string }[]
  plan: SkillEnablementPlan
  resolution: Map<string, EffectiveSkillResolution>
  droppedStateKeys: string[]
  /** True when a persisted state file existed but no usable envelope recovered. */
  stateFileUnreadable: boolean
}

export function userDefaultsStatePath(homeDirectory: string): string {
  return join(homeDirectory, SKILL_ENABLEMENT_STATE_DIRNAME, SKILL_USER_DEFAULTS_FILENAME)
}

/** The vault root backing a scope; project scope uses the project vault only when it exists. */
export function enablementVaultRoot(input: {
  scope: SkillEnablementScope
  homeDirectory: string
  workspaceDirectory?: string
}): string {
  return input.scope === 'global'
    ? userSkillVaultRoot(input.homeDirectory)
    : projectSkillVaultRoot(input.workspaceDirectory ?? '')
}

export function projectStatePath(workspaceDirectory: string): string {
  return join(workspaceDirectory, SKILL_ENABLEMENT_STATE_DIRNAME, SKILL_PROJECT_STATE_FILENAME)
}

async function readOptionalFile(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null)
}

async function syncCopyModeIndexPlacements(input: {
  indexPath: string
  vaultRoot: string
  plan: SkillEnablementPlan
  executed: readonly ExecutedEnablementStep[]
  copyMode: boolean
}): Promise<void> {
  const index = await readSkillVaultIndex(input.indexPath)
  if (!index) {
    return
  }
  const semantics = nativeSkillPathSemantics()
  const executedKeys = new Set(input.executed.map((step) => `${step.skillId}:${step.provider}`))
  const topology = input.copyMode
    ? 'copy'
    : process.platform === 'win32'
      ? 'junction'
      : 'symlink'

  let dirty = false
  const nextEntries = [...index.entries]

  for (const action of input.plan.actions) {
    if (action.kind === 'keep' || action.kind === 'adopt-canonical-to-vault') {
      continue
    }
    const key = `${action.observation.skillId}:${action.observation.provider}`
    if (!executedKeys.has(key)) {
      continue
    }
    const entryIndex = nextEntries.findIndex((entry) => entry.id === action.observation.skillId)
    if (entryIndex === -1) {
      continue
    }
    const entry = nextEntries[entryIndex]
    const placementPath = join(action.observation.rootPath, action.observation.skillId)
    const placementKey = normalizedSkillPath(placementPath, semantics)
    const placements: Record<string, ManagedPlacementRecord> = {
      ...(entry.managedPlacements ?? {})
    }
    if (action.kind === 'remove') {
      if (placementKey in placements) {
        delete placements[placementKey]
        dirty = true
      }
    } else {
      const vaultDigest = await computeSkillVaultDigest(
        skillVaultEntryRoot(input.vaultRoot, entry.id)
      ).catch(() => entry.digest)
      const destStat = await stat(placementPath).catch(() => null)
      placements[placementKey] = {
        topology,
        syncedDigest: vaultDigest,
        ...(destStat ? { syncedMtimeMs: destStat.mtimeMs } : {})
      }
      dirty = true
    }
    nextEntries[entryIndex] = {
      ...entry,
      managedPlacements: placements
    }
  }

  if (dirty) {
    await rebuildSkillVaultIndex(input.indexPath, nextEntries)
  }
}

/**
 * One enablement change = state-file update + plan diff + transactional placement batch.
 * An interrupted previous batch is replayed to convergence before the fresh plan runs.
 */
export async function runSkillEnablementCommand(input: {
  command: SkillEnablementCommand
  runtime: SkillEnablementRuntimeInput
  /** Test seam for T2.11. */
  interruptAfterCount?: number
}): Promise<SkillEnablementResult> {
  const runtime = input.runtime
  const scopeRoot = runtime.scope === 'global' ? runtime.homeDirectory : runtime.workspaceDirectory
  if (!scopeRoot) {
    throw new Error('skill-enablement-workspace-required')
  }
  const canonicalRoot =
    runtime.canonicalRoot === null
      ? undefined
      : (runtime.canonicalRoot ?? join(scopeRoot, '.agents', 'skills'))
  const replayed = await recoverEnablementJournal(
    runtime.stateDirectory,
    runtime.fileIO.readFileBounded,
    runtime.readonlyRoots
  )

  const userDefaultsPath = userDefaultsStatePath(runtime.homeDirectory)
  const projectStateFile =
    runtime.workspaceDirectory === undefined ? null : projectStatePath(runtime.workspaceDirectory)
  const [userDefaultsSalvage, projectStateSalvage, installedSkillIds, vaultIndex] =
    await Promise.all([
      readOptionalFile(userDefaultsPath).then((raw) =>
        parseSkillUserDefaultsFile(raw, runtime.fileIO.salvage)
      ),
      projectStateFile === null
        ? Promise.resolve(parseSkillProjectStateFile(null, runtime.fileIO.salvage))
        : readOptionalFile(projectStateFile).then((raw) =>
            parseSkillProjectStateFile(raw, runtime.fileIO.salvage)
          ),
      listInstalledSkillIds(runtime.vaultRoot, canonicalRoot ?? runtime.vaultRoot),
      runtime.indexPath ? readSkillVaultIndex(runtime.indexPath) : Promise.resolve(null)
    ])
  const unknown = input.command.skillIds.filter((id) => !installedSkillIds.includes(id))
  if (unknown.length > 0) {
    throw new Error(
      `skill-enablement-unknown-skill: ${unknown.join(', ')}. In vault: ${
        installedSkillIds.join(', ') || '(none)'
      }`
    )
  }

  const userDefaults: SkillUserDefaults = { ...userDefaultsSalvage.value }
  const projectOverrides: SkillProjectOverrides = { ...projectStateSalvage.value }
  const userAgentOverrides: SkillAgentOverrides = { ...(userDefaultsSalvage.agentOverrides ?? {}) }
  const projectAgentOverrides: SkillAgentOverrides = {
    ...(projectStateSalvage.agentOverrides ?? {})
  }

  const touched = new Set(input.command.skillIds)
  if (input.command.kind === 'inherit') {
    for (const id of touched) {
      delete projectOverrides[id]
      delete projectAgentOverrides[id]
    }
    if (projectStateFile !== null) {
      await writeSkillStateFile(
        projectStateFile,
        skillProjectStateFileValue(projectOverrides, projectAgentOverrides)
      )
    }
  } else if (input.command.scope === 'user') {
    for (const id of touched) {
      if (input.command.agents) {
        userAgentOverrides[id] = {
          ...(userAgentOverrides[id] ?? {}),
          ...input.command.agents
        }
      } else {
        userDefaults[id] = input.command.kind === 'enable' ? 'enabled' : 'disabled'
      }
    }
    await writeSkillStateFile(
      userDefaultsPath,
      skillUserDefaultsFileValue(userDefaults, userAgentOverrides)
    )
  } else {
    for (const id of touched) {
      if (input.command.agents) {
        projectAgentOverrides[id] = {
          ...(projectAgentOverrides[id] ?? {}),
          ...input.command.agents
        }
      } else {
        projectOverrides[id] = input.command.kind === 'enable' ? 'enabled' : 'disabled'
      }
    }
    if (projectStateFile !== null) {
      await writeSkillStateFile(
        projectStateFile,
        skillProjectStateFileValue(projectOverrides, projectAgentOverrides)
      )
    }
  }

  const providers =
    runtime.selectedProviders && runtime.selectedProviders.length > 0
      ? runtime.selectedProviders
      : runtime.detectedProviders
  const destinations: SkillProviderDestination[] = resolveSkillProviderDestinations({
    scope: runtime.scope,
    homeDirectory: runtime.homeDirectory,
    ...(runtime.workspaceDirectory ? { workspaceDirectory: runtime.workspaceDirectory } : {}),
    detectedProviders: providers,
    ...(runtime.providerRootOverrides
      ? { providerRootOverrides: runtime.providerRootOverrides }
      : {})
  })
  const copyMode = runtime.copyMode ?? (await detectSkillVaultCopyMode(runtime.vaultRoot))

  const plan = await planSkillEnablement({
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
  })
  const executed = await applyPlanTransactionally({
    stateDirectory: runtime.stateDirectory,
    plan,
    vaultRoot: runtime.vaultRoot,
    canonicalRoot: canonicalRoot ?? runtime.vaultRoot,
    readonlyRoots: runtime.readonlyRoots,
    interruptAfterCount: input.interruptAfterCount
  })
  if (runtime.indexPath) {
    await syncCopyModeIndexPlacements({
      indexPath: runtime.indexPath,
      vaultRoot: runtime.vaultRoot,
      plan,
      executed,
      copyMode
    })
  }
  const conflicts = plan.conflicts.map((observation) => ({
    skillId: observation.skillId,
    provider: observation.provider,
    rootPath: observation.rootPath
  }))
  const readonlyBlocked = plan.readonlyBlocked.map((observation) => ({
    skillId: observation.skillId,
    provider: observation.provider,
    rootPath: observation.rootPath
  }))
  const changed = executed.length + replayed.executed.length > 0
  return {
    status:
      conflicts.length > 0 || readonlyBlocked.length > 0
        ? changed
          ? 'partial'
          : 'conflict'
        : 'applied',
    executed: [...replayed.executed, ...executed],
    conflicts,
    readonlyBlocked,
    plan,
    resolution: resolveEffectiveSkills({
      installed: installedSkillIds,
      userDefaults,
      projectOverrides,
      userAgentOverrides,
      projectAgentOverrides,
      scope: runtime.scope
    }),
    droppedStateKeys: [...userDefaultsSalvage.droppedKeys, ...projectStateSalvage.droppedKeys],
    stateFileUnreadable: userDefaultsSalvage.unreadable || projectStateSalvage.unreadable
  }
}

/** The read-only view behind `pms skills effective`: resolution plus placement reality. */
export async function readSkillEnablementState(input: {
  runtime: SkillEnablementRuntimeInput
  includeAgents?: boolean
}): Promise<{
  resolution: Map<string, EffectiveSkillResolution>
  installedSkillIds: string[]
  userDefaults: SkillUserDefaults
  projectOverrides: SkillProjectOverrides
  userAgentOverrides?: SkillAgentOverrides
  projectAgentOverrides?: SkillAgentOverrides
  droppedStateKeys: string[]
  stateFileUnreadable: boolean
}> {
  const runtime = input.runtime
  const scopeRoot = runtime.scope === 'global' ? runtime.homeDirectory : runtime.workspaceDirectory
  const canonicalRoot = join(scopeRoot ?? runtime.homeDirectory, '.agents', 'skills')
  const projectStateFile =
    runtime.workspaceDirectory === undefined ? null : projectStatePath(runtime.workspaceDirectory)
  const [userDefaultsSalvage, projectStateSalvage, installedSkillIds] = await Promise.all([
    readOptionalFile(userDefaultsStatePath(runtime.homeDirectory)).then((raw) =>
      parseSkillUserDefaultsFile(raw, runtime.fileIO.salvage)
    ),
    projectStateFile === null
      ? Promise.resolve(parseSkillProjectStateFile(null, runtime.fileIO.salvage))
      : readOptionalFile(projectStateFile).then((raw) =>
          parseSkillProjectStateFile(raw, runtime.fileIO.salvage)
        ),
    listInstalledSkillIds(runtime.vaultRoot, canonicalRoot)
  ])
  return {
    resolution: resolveEffectiveSkills({
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
  }
}
