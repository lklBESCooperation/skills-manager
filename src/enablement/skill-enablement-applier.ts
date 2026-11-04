import { readFile } from 'node:fs/promises'
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
  type EffectiveSkillResolution,
  type SkillEnablementSalvage,
  type SkillProjectOverrides,
  type SkillUserDefaults
} from '../contracts/skill-enablement'
import { nativeSkillPathSemantics, skillPathInside } from '../contracts/skill-path-containment'
import {
  resolveSkillProviderDestinations,
  type SkillProviderDestination,
  type SkillProviderRootOverrides
} from '../infra/skill-provider-destinations'
import { writeSkillStateFile } from '../infra/skill-state-store'
import { projectSkillVaultRoot, userSkillVaultRoot } from '../vault/skill-vault-paths'
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
    }
  /** Project-level only: delete the override key and re-place from the resolution. */
  | { kind: 'inherit'; skillIds: readonly string[] }

export type SkillEnablementRuntimeInput = {
  scope: SkillEnablementScope
  homeDirectory: string
  workspaceDirectory?: string
  /** Injected vault root; P1 owns the real layout (`~/.pmstudio/skills`), tests build fakes. */
  vaultRoot: string
  /** Journal location for the placement batch; defaults beside the state files. */
  stateDirectory: string
  detectedProviders: readonly string[]
  selectedProviders?: readonly string[]
  providerRootOverrides?: SkillProviderRootOverrides
  /** Host-injected file IO; the CLI entry binds the app's shared implementations. */
  fileIO: SkillEnablementFileIO
}

export type SkillEnablementResult = {
  status: 'applied' | 'conflict' | 'partial'
  executed: ExecutedEnablementStep[]
  conflicts: { skillId: string; provider: string; rootPath: string }[]
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
  const canonicalRoot = join(scopeRoot, '.agents', 'skills')
  // Moves relocate the single master; only legal when vault and canonical share the scope.
  const canonicalMoveAllowed = skillPathInside(
    scopeRoot,
    runtime.vaultRoot,
    nativeSkillPathSemantics()
  )
  const replayed = await recoverEnablementJournal(
    runtime.stateDirectory,
    runtime.fileIO.readFileBounded
  )

  const userDefaultsPath = userDefaultsStatePath(runtime.homeDirectory)
  const projectStateFile =
    runtime.workspaceDirectory === undefined ? null : projectStatePath(runtime.workspaceDirectory)
  const [userDefaultsSalvage, projectStateSalvage, installedSkillIds] = await Promise.all([
    readOptionalFile(userDefaultsPath).then((raw) =>
      parseSkillUserDefaultsFile(raw, runtime.fileIO.salvage)
    ),
    projectStateFile === null
      ? Promise.resolve(parseSkillProjectStateFile(null, runtime.fileIO.salvage))
      : readOptionalFile(projectStateFile).then((raw) =>
          parseSkillProjectStateFile(raw, runtime.fileIO.salvage)
        ),
    listInstalledSkillIds(runtime.vaultRoot, canonicalRoot)
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
  const projectOverrides: SkillProjectOverrides = {
    ...projectStateSalvage.value
  }
  const touched = new Set(input.command.skillIds)
  if (input.command.kind === 'inherit') {
    for (const id of touched) {
      delete projectOverrides[id]
    }
    if (projectStateFile !== null) {
      await writeSkillStateFile(projectStateFile, skillProjectStateFileValue(projectOverrides))
    }
  } else if (input.command.scope === 'user') {
    for (const id of touched) {
      userDefaults[id] = input.command.kind === 'enable' ? 'enabled' : 'disabled'
    }
    await writeSkillStateFile(userDefaultsPath, skillUserDefaultsFileValue(userDefaults))
  } else {
    for (const id of touched) {
      projectOverrides[id] = input.command.kind === 'enable' ? 'enabled' : 'disabled'
    }
    if (projectStateFile !== null) {
      await writeSkillStateFile(projectStateFile, skillProjectStateFileValue(projectOverrides))
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

  const plan = await planSkillEnablement({
    vaultRoot: runtime.vaultRoot,
    installedSkillIds,
    userDefaults,
    projectOverrides,
    destinations,
    canonicalRoot,
    canonicalMoveAllowed
  })
  const executed = await applyPlanTransactionally({
    stateDirectory: runtime.stateDirectory,
    plan,
    vaultRoot: runtime.vaultRoot,
    canonicalRoot,
    interruptAfterCount: input.interruptAfterCount
  })
  const conflicts = plan.conflicts.map((observation) => ({
    skillId: observation.skillId,
    provider: observation.provider,
    rootPath: observation.rootPath
  }))
  const changed = executed.length + replayed.executed.length > 0
  return {
    status: conflicts.length > 0 ? (changed ? 'partial' : 'conflict') : 'applied',
    executed: [...replayed.executed, ...executed],
    conflicts,
    plan,
    resolution: resolveEffectiveSkills({
      installed: installedSkillIds,
      userDefaults,
      projectOverrides
    }),
    droppedStateKeys: [...userDefaultsSalvage.droppedKeys, ...projectStateSalvage.droppedKeys],
    stateFileUnreadable: userDefaultsSalvage.unreadable || projectStateSalvage.unreadable
  }
}

/** The read-only view behind `pms skills effective`: resolution plus placement reality. */
export async function readSkillEnablementState(input: {
  runtime: SkillEnablementRuntimeInput
}): Promise<{
  resolution: Map<string, EffectiveSkillResolution>
  installedSkillIds: string[]
  userDefaults: SkillUserDefaults
  projectOverrides: SkillProjectOverrides
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
      projectOverrides: projectStateSalvage.value
    }),
    installedSkillIds,
    userDefaults: userDefaultsSalvage.value,
    projectOverrides: projectStateSalvage.value,
    droppedStateKeys: [...userDefaultsSalvage.droppedKeys, ...projectStateSalvage.droppedKeys],
    stateFileUnreadable: userDefaultsSalvage.unreadable || projectStateSalvage.unreadable
  }
}
