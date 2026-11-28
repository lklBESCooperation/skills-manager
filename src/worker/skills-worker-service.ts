import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { AGENT_SKILL_DESCRIPTORS } from '../contracts/agent-skill-registry'
import type { PluginSkillRecord } from '../contracts/plugin-skill-contract'
import type { SkillAuditReport } from '../contracts/skill-audit-contract'
import {
  resolveEffectiveSkills,
  type AgentId,
  type SkillEnablementOrigin
} from '../contracts/skill-enablement'
import { summarizeSkillMarkdown } from '../contracts/skill-metadata'
import type {
  SkillPackExportBundle,
  SkillPackOperationMode,
  SkillPackScope,
  SkillPackV2
} from '../contracts/skill-pack-contract'
import type {
  AdoptableSkillViewItem,
  AgentRegistrySummaryItem,
  ManagedSkillSourceKind,
  ManagedSkillViewItem,
  PackApplyOutput,
  PackImportOutput,
  PackListOutput,
  PackPreviewOutput,
  PackRollbackOutput,
  PluginsRescanOutput,
  QuickPanelSnapshotOutput,
  SkillAdoptInput,
  SkillAdoptOutput,
  SkillAgentMatrixInput,
  SkillAgentMatrixOutput,
  SkillMutateConflictItem,
  SkillMutateInput,
  SkillMutateOutput,
  SkillScopeKind,
  WorkbenchSnapshotOutput,
  WorkspaceContextSummary
} from '../contracts/skill-ui-bridge-contract'
import type { SkillVaultIndex } from '../contracts/skill-vault-contract'
import { auditSkillsHealth } from '../audit/skill-audit-service'
import { BatchCoordinator } from '../enablement/batch-coordinator'
import { listInstalledSkillIds } from '../enablement/installed-skill-inventory'
import {
  readSkillEnablementState,
  runSkillEnablementCommand,
  type SkillEnablementRuntimeInput
} from '../enablement/skill-enablement-applier'
import { isReadonlySkillTarget } from '../infra/readonly-root-fence'
import { createLocalSkillEnablementFileIO } from '../infra/local-enablement-file-io'
import { detectPackLocalAgents } from '../packs/pack-local-agent-detection'
import type { SkillPackPreview } from '../packs/skill-pack-preview'
import type { SkillVaultEntryLike } from '../packs/skill-pack-rule-eval'
import { SkillPackService, skillPackFilePath } from '../packs/skill-pack-service'
import { scanReadonlyPluginSkills } from '../vault/readonly-plugin-scanner'
import { adoptSkillsIntoVault } from '../vault/skill-vault-adopt'
import { readSkillVaultIndexWithLegacyFallback } from '../vault/skill-vault-index-service'
import {
  legacyProjectSkillVaultIndexPath,
  projectSkillVaultIndexPath,
  projectSkillVaultRoot,
  userSkillVaultIndexPath,
  userSkillVaultRoot
} from '../vault/skill-vault-paths'
import {
  adoptableSkillVaultItems,
  scanSkillVault,
  type SkillVaultScanPlan
} from '../vault/skill-vault-scan'
import { isSkillStagingEntryName } from '../vault/staging-marker'

const MAX_SKILL_MD_BYTES = 256 * 1024
const MAX_SNAPSHOT_DESCRIPTION_CHARS = 300

function truncateDescription(description: string | null): string | null {
  if (description === null || description.length <= MAX_SNAPSHOT_DESCRIPTION_CHARS) {
    return description
  }
  return `${description.slice(0, MAX_SNAPSHOT_DESCRIPTION_CHARS - 1).trimEnd()}…`
}

function omitAgentMatrix<T extends { agents?: unknown; agentDetails?: unknown }>(
  item: T
): Omit<T, 'agents' | 'agentDetails'> {
  const { agents: _agents, agentDetails: _details, ...rest } = item
  return rest
}

function truncatePluginDescriptions(skills: readonly PluginSkillRecord[]): PluginSkillRecord[] {
  return skills.map((skill) => ({
    ...skill,
    description: truncateDescription(skill.description)
  }))
}

export type HostWorkspaceRow = {
  id: string
  kind?: 'worktree' | 'folder'
  name: string
  path: string
  branch?: string | null
  hostId: string | null
}

export type HostContextPayload = {
  workspaceId?: string
  branch?: string
  displayName?: string
} | null

export type WorkerHostBridge = {
  readWorkspaceContext(): Promise<HostContextPayload>
  listWorkspaces(): Promise<{ workspaces: HostWorkspaceRow[] }>
}

export type ResolvedLocalWorkspace = WorkspaceContextSummary & {
  workspaceDirectory?: string
}

export type SkillsWorkerServiceOptions = {
  homeDirectory: string
  pluginRoot?: string
  etcCodexSkillsRoot?: string
  hostBridge: WorkerHostBridge
  batchCoordinator?: BatchCoordinator
}

function isLocalHostId(hostId: string | null | undefined): boolean {
  return hostId === null || hostId === undefined || hostId === 'local'
}

function buildAgentRegistrySummary(): AgentRegistrySummaryItem[] {
  return AGENT_SKILL_DESCRIPTORS.map((descriptor) => ({
    id: descriptor.id,
    displayName: descriptor.displayName,
    capability: descriptor.capability,
    readsCanonical: descriptor.readsCanonical.global || descriptor.readsCanonical.workspace,
    ...(descriptor.delegatesTo ? { delegatesTo: descriptor.delegatesTo } : {})
  }))
}

async function readSkillMdSummary(
  skillDirectories: readonly string[]
): Promise<{ name: string | null; description: string | null }> {
  for (const dir of skillDirectories) {
    const filePath = join(dir, 'SKILL.md')
    const info = await stat(filePath).catch(() => null)
    if (!info || !info.isFile() || info.size > MAX_SKILL_MD_BYTES) {
      continue
    }
    const content = await readFile(filePath, 'utf8').catch(() => null)
    if (content !== null) {
      return summarizeSkillMarkdown(content)
    }
  }
  return { name: null, description: null }
}

async function listDirectSubdirNames(root: string): Promise<Set<string>> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const names = new Set<string>()
  for (const entry of entries) {
    if (entry.name.startsWith('.') || isSkillStagingEntryName(entry.name)) {
      continue
    }
    const full = join(root, entry.name)
    const isDir =
      entry.isDirectory() ||
      (entry.isSymbolicLink() && ((await stat(full).catch(() => null))?.isDirectory() ?? false))
    if (isDir) {
      names.add(entry.name)
    }
  }
  return names
}

async function isSymlinkIntoRoot(candidatePath: string, targetRoot: string): Promise<boolean> {
  const linkStat = await lstat(candidatePath).catch(() => null)
  if (!linkStat || !linkStat.isSymbolicLink()) {
    return false
  }
  const realCandidate = await realpath(candidatePath).catch(() => null)
  const realRoot = await realpath(targetRoot).catch(() => resolve(targetRoot))
  if (!realCandidate) {
    return false
  }
  const prefix = realRoot.endsWith('/') || realRoot.endsWith('\\') ? realRoot : `${realRoot}/`
  return (
    realCandidate === realRoot ||
    realCandidate.replace(/\\/g, '/').startsWith(prefix.replace(/\\/g, '/'))
  )
}

async function collectCandidatePathsForScope(
  scope: 'global' | 'workspace',
  baseDir: string
): Promise<string[]> {
  const seen = new Set<string>()
  const candidates: string[] = []
  const roots: string[] = [join(baseDir, '.agents', 'skills')]

  for (const descriptor of AGENT_SKILL_DESCRIPTORS) {
    if (descriptor.capability === 'unsupported' || descriptor.capability === 'delegate') {
      continue
    }
    const targetSegs =
      scope === 'global'
        ? descriptor.installTargets.globalSegments
        : descriptor.installTargets.workspaceSegments
    if (targetSegs) {
      roots.push(join(baseDir, ...targetSegs))
    }
    const extraSegs =
      scope === 'global'
        ? descriptor.discoveryOnlyRoots?.globalSegments
        : descriptor.discoveryOnlyRoots?.workspaceSegments
    if (extraSegs) {
      for (const segs of extraSegs) {
        roots.push(join(baseDir, ...segs))
      }
    }
  }

  for (const root of new Set(roots)) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.') || isSkillStagingEntryName(entry.name)) {
        continue
      }
      const full = join(root, entry.name)
      const isDir =
        entry.isDirectory() ||
        (entry.isSymbolicLink() && ((await stat(full).catch(() => null))?.isDirectory() ?? false))
      if (isDir && !seen.has(full)) {
        seen.add(full)
        candidates.push(full)
      }
    }
  }
  return candidates.sort()
}

export class SkillsWorkerService {
  private readonly fileIO = createLocalSkillEnablementFileIO()
  private readonly coordinator: BatchCoordinator
  private readonly agentRegistry: AgentRegistrySummaryItem[] = buildAgentRegistrySummary()

  constructor(private readonly options: SkillsWorkerServiceOptions) {
    this.coordinator = options.batchCoordinator ?? new BatchCoordinator()
  }

  async resolveActiveWorkspace(): Promise<ResolvedLocalWorkspace> {
    const context = await this.options.hostBridge.readWorkspaceContext().catch(() => null)
    const workspaceId = context?.workspaceId ?? null
    if (!workspaceId) {
      return {
        workspaceId: null,
        workspaceName: context?.displayName ?? null,
        isLocalDirectoryAvailable: false
      }
    }
    const listed = await this.options.hostBridge.listWorkspaces().catch(() => ({ workspaces: [] }))
    const row = listed.workspaces.find((item) => item.id === workspaceId)
    if (!row || !isLocalHostId(row.hostId) || !row.path) {
      return {
        workspaceId,
        workspaceName: context?.displayName ?? row?.name ?? null,
        isLocalDirectoryAvailable: false
      }
    }
    return {
      workspaceId,
      workspaceName: context?.displayName || row.name || basename(row.path),
      isLocalDirectoryAvailable: true,
      workspaceDirectory: row.path
    }
  }

  private async detectProviders(workspaceDirectory?: string): Promise<string[]> {
    const providers = new Set<string>(detectPackLocalAgents(this.options.homeDirectory))
    if (workspaceDirectory) {
      for (const descriptor of AGENT_SKILL_DESCRIPTORS) {
        if (descriptor.capability !== 'managed') {
          continue
        }
        const segs = descriptor.installTargets.workspaceSegments ?? ['.agents', 'skills']
        const exists = await stat(join(workspaceDirectory, ...segs))
          .then((s) => s.isDirectory())
          .catch(() => false)
        if (exists) {
          providers.add(descriptor.id)
        }
      }
    }
    return [...providers]
  }

  private async scanPluginsSafe(workspaceDirectory?: string): Promise<{
    pluginSkills: PluginSkillRecord[]
    readonlyRoots: string[]
    pluginScanError: string | null
  }> {
    try {
      const result = await scanReadonlyPluginSkills({
        homeDirectory: this.options.homeDirectory,
        ...(workspaceDirectory ? { workspaceDirectory } : {}),
        ...(this.options.pluginRoot ? { pluginRoot: this.options.pluginRoot } : {}),
        ...(this.options.etcCodexSkillsRoot
          ? { etcCodexSkillsRoot: this.options.etcCodexSkillsRoot }
          : {})
      })
      return {
        pluginSkills: truncatePluginDescriptions(result.skills),
        readonlyRoots: result.readonlyRoots,
        pluginScanError: null
      }
    } catch (error) {
      return {
        pluginSkills: [],
        readonlyRoots: [],
        pluginScanError: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async resolveWorkspaceSkillIds(
    ws: string,
    userSkillIds: readonly string[]
  ): Promise<{ wsVaultRoot: string; wsVaultIds: Set<string>; wsSkillIds: string[] }> {
    const userVaultRoot = userSkillVaultRoot(this.options.homeDirectory)
    const wsVaultRoot = projectSkillVaultRoot(ws)
    const wsCanonicalRoot = join(ws, '.agents', 'skills')
    const [wsVaultIds, rawWsSkillIds] = await Promise.all([
      listDirectSubdirNames(wsVaultRoot),
      listInstalledSkillIds(wsVaultRoot, wsCanonicalRoot)
    ])
    const userIdSet = new Set(userSkillIds)
    const wsSkillIds: string[] = []
    for (const id of rawWsSkillIds) {
      if (wsVaultIds.has(id)) {
        wsSkillIds.push(id)
        continue
      }
      // Skip canonical symlinks that point into the user vault (workspace placement of user skill).
      if (
        userIdSet.has(id) &&
        (await isSymlinkIntoRoot(join(wsCanonicalRoot, id), userVaultRoot))
      ) {
        continue
      }
      if (!userIdSet.has(id)) {
        wsSkillIds.push(id)
      }
    }
    return { wsVaultRoot, wsVaultIds, wsSkillIds }
  }

  private async collectManagedAndAdoptable(input: {
    workspaceDirectory?: string
    readonlyRoots: readonly string[]
    includeAgents: boolean
    includeAdoptable: boolean
  }): Promise<{
    managedSkills: ManagedSkillViewItem[]
    adoptableSkills: AdoptableSkillViewItem[]
  }> {
    const home = this.options.homeDirectory
    const ws = input.workspaceDirectory
    const userVaultRoot = userSkillVaultRoot(home)
    const userIndexPath = userSkillVaultIndexPath(home)
    const userCanonicalRoot = join(home, '.agents', 'skills')
    const detectedProviders = await this.detectProviders(ws)

    const [userIndex, userState, userVaultIds] = await Promise.all([
      readSkillVaultIndexWithLegacyFallback(userIndexPath),
      readSkillEnablementState({
        runtime: {
          scope: ws ? 'workspace' : 'global',
          homeDirectory: home,
          ...(ws ? { workspaceDirectory: ws } : {}),
          vaultRoot: userVaultRoot,
          indexPath: userIndexPath,
          stateDirectory: join(ws ?? home, '.pmstudio', 'state'),
          detectedProviders,
          readonlyRoots: input.readonlyRoots,
          fileIO: this.fileIO
        },
        includeAgents: input.includeAgents
      }),
      listDirectSubdirNames(userVaultRoot)
    ])

    const userSkillIds = await listInstalledSkillIds(userVaultRoot, userCanonicalRoot)

    let wsIndex: SkillVaultIndex | null = null
    let wsSkillIds: string[] = []
    let wsVaultIds = new Set<string>()
    let wsVaultRoot = ''

    if (ws) {
      const wsIndexPath = projectSkillVaultIndexPath(ws)
      const [loadedWsIndex, resolvedWs] = await Promise.all([
        readSkillVaultIndexWithLegacyFallback(wsIndexPath, legacyProjectSkillVaultIndexPath(ws)),
        this.resolveWorkspaceSkillIds(ws, userSkillIds)
      ])
      wsIndex = loadedWsIndex
      wsVaultRoot = resolvedWs.wsVaultRoot
      wsVaultIds = resolvedWs.wsVaultIds
      wsSkillIds = resolvedWs.wsSkillIds
    }

    const userResolution = resolveEffectiveSkills({
      installed: userSkillIds,
      userDefaults: userState.userDefaults,
      projectOverrides: ws ? userState.projectOverrides : {},
      userAgentOverrides: userState.userAgentOverrides,
      projectAgentOverrides: ws ? userState.projectAgentOverrides : {},
      scope: ws ? 'workspace' : 'global',
      includeAgents: input.includeAgents
    })

    const wsResolution = ws
      ? resolveEffectiveSkills({
          installed: wsSkillIds,
          userDefaults: userState.userDefaults,
          projectOverrides: userState.projectOverrides,
          userAgentOverrides: userState.userAgentOverrides,
          projectAgentOverrides: userState.projectAgentOverrides,
          scope: 'workspace',
          includeAgents: input.includeAgents
        })
      : new Map()

    const supportedDescriptors = AGENT_SKILL_DESCRIPTORS.filter(
      (descriptor) => descriptor.capability !== 'unsupported'
    )

    const buildViewItems = async (params: {
      ids: readonly string[]
      scope: SkillScopeKind
      vaultRoot: string
      canonicalRoot: string
      vaultIds: Set<string>
      index: SkillVaultIndex | null
      resolutionMap: typeof userResolution
    }): Promise<ManagedSkillViewItem[]> => {
      const items: ManagedSkillViewItem[] = []
      const entryById = new Map((params.index?.entries ?? []).map((entry) => [entry.id, entry]))

      for (const id of params.ids) {
        const entry = entryById.get(id)
        const resolution = params.resolutionMap.get(id)
        if (!resolution) {
          continue
        }
        let name = entry?.name ?? null
        let description = entry?.description ?? null
        if (!name || description === null) {
          const fallback = await readSkillMdSummary([
            join(params.vaultRoot, id),
            join(params.canonicalRoot, id)
          ])
          name = name ?? fallback.name ?? id
          description = description ?? fallback.description
        }

        const sourceKind: ManagedSkillSourceKind = entry
          ? entry.sourceKind
          : params.vaultIds.has(id)
            ? 'installed'
            : 'canonical-unindexed'

        const agents = resolution.agents ?? {}
        const agentDetails = resolution.agentDetails ?? {}
        let enabledAgentCount = 0
        if (input.includeAgents) {
          for (const descriptor of supportedDescriptors) {
            if (agents[descriptor.id]) {
              enabledAgentCount += 1
            }
          }
        } else {
          enabledAgentCount = resolution.effective === 'enabled' ? supportedDescriptors.length : 0
        }

        const effectiveOrigin: SkillEnablementOrigin =
          params.scope === 'workspace' && !ws ? 'user' : resolution.origin

        items.push({
          rowKey: `${params.scope}:${id}`,
          id,
          name,
          description: truncateDescription(description),
          sourceKind,
          scope: params.scope,
          tags: entry?.tags ?? [],
          author: entry?.author ?? null,
          copyMode: Boolean(entry?.copyMode),
          effective: resolution.effective,
          origin: effectiveOrigin,
          enabledAgentCount,
          supportedAgentCount: supportedDescriptors.length,
          agents,
          agentDetails
        })
      }
      return items
    }

    const [userItems, wsItems] = await Promise.all([
      buildViewItems({
        ids: userSkillIds,
        scope: 'user',
        vaultRoot: userVaultRoot,
        canonicalRoot: userCanonicalRoot,
        vaultIds: userVaultIds,
        index: userIndex,
        resolutionMap: userResolution
      }),
      ws
        ? buildViewItems({
            ids: wsSkillIds,
            scope: 'workspace',
            vaultRoot: wsVaultRoot,
            canonicalRoot: join(ws, '.agents', 'skills'),
            vaultIds: wsVaultIds,
            index: wsIndex,
            resolutionMap: wsResolution
          })
        : Promise.resolve([])
    ])

    const managedSkills = [...wsItems, ...userItems].sort(
      (a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope) || a.id.localeCompare(b.id)
    )

    const adoptableSkills: AdoptableSkillViewItem[] = []
    if (input.includeAdoptable) {
      const scanAndMap = async (
        scope: SkillScopeKind,
        baseDir: string,
        vaultRoot: string,
        index: SkillVaultIndex | null
      ): Promise<void> => {
        const candidatePaths = await collectCandidatePathsForScope(
          scope === 'user' ? 'global' : 'workspace',
          baseDir
        )
        const plan: SkillVaultScanPlan = await scanSkillVault({
          homeDirectory: home,
          vaultRoot,
          candidatePaths,
          index,
          readonlyRoots: input.readonlyRoots
        })
        for (const item of plan.items) {
          if (item.disposition !== 'adoptable' && item.disposition !== 'conflict') {
            continue
          }
          const summary = await readSkillMdSummary([item.originPath])
          adoptableSkills.push({
            rowKey: `${scope}:${item.id}`,
            id: item.id,
            name: summary.name ?? item.id,
            description: truncateDescription(summary.description),
            scope,
            disposition: item.disposition,
            digest: item.digest,
            originPath: item.originPath,
            mergePaths: item.mergePaths,
            conflictCount: item.conflicts.length
          })
        }
      }

      await scanAndMap('user', home, userVaultRoot, userIndex)
      if (ws) {
        await scanAndMap('workspace', ws, wsVaultRoot, wsIndex)
      }
      adoptableSkills.sort(
        (a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope) || a.id.localeCompare(b.id)
      )
    }

    return { managedSkills, adoptableSkills }
  }

  async getWorkbenchSnapshot(): Promise<WorkbenchSnapshotOutput> {
    const activeWorkspace = await this.resolveActiveWorkspace()
    const { pluginSkills, readonlyRoots, pluginScanError } = await this.scanPluginsSafe(
      activeWorkspace.workspaceDirectory
    )
    const { managedSkills, adoptableSkills } = await this.collectManagedAndAdoptable({
      workspaceDirectory: activeWorkspace.workspaceDirectory,
      readonlyRoots,
      includeAgents: true,
      includeAdoptable: true
    })

    return {
      activeWorkspace: {
        workspaceId: activeWorkspace.workspaceId,
        workspaceName: activeWorkspace.workspaceName,
        isLocalDirectoryAvailable: activeWorkspace.isLocalDirectoryAvailable
      },
      agentRegistry: this.agentRegistry,
      managedSkills: managedSkills.map(omitAgentMatrix),
      adoptableSkills,
      pluginSkills,
      pluginScanError,
      generatedAt: Date.now()
    }
  }

  async getQuickPanelSnapshot(): Promise<QuickPanelSnapshotOutput> {
    const activeWorkspace = await this.resolveActiveWorkspace()
    const { pluginSkills, readonlyRoots } = await this.scanPluginsSafe(
      activeWorkspace.workspaceDirectory
    )
    const { managedSkills, adoptableSkills } = await this.collectManagedAndAdoptable({
      workspaceDirectory: activeWorkspace.workspaceDirectory,
      readonlyRoots,
      includeAgents: true,
      includeAdoptable: true
    })

    return {
      activeWorkspace: {
        workspaceId: activeWorkspace.workspaceId,
        workspaceName: activeWorkspace.workspaceName,
        isLocalDirectoryAvailable: activeWorkspace.isLocalDirectoryAvailable
      },
      managedSkills: managedSkills.map(omitAgentMatrix),
      pluginSkillCount: pluginSkills.length,
      adoptableCount: adoptableSkills.length,
      generatedAt: Date.now()
    }
  }

  async getSkillAgentMatrix(input: SkillAgentMatrixInput): Promise<SkillAgentMatrixOutput> {
    const activeWorkspace = await this.resolveActiveWorkspace()
    const ws = activeWorkspace.workspaceDirectory
    if (input.scope === 'workspace' && !ws) {
      throw new Error('skill-enablement-workspace-required')
    }

    const home = this.options.homeDirectory
    const userVaultRoot = userSkillVaultRoot(home)
    const userIndexPath = userSkillVaultIndexPath(home)
    const userCanonicalRoot = join(home, '.agents', 'skills')
    const userSkillIds = await listInstalledSkillIds(userVaultRoot, userCanonicalRoot)

    if (input.scope === 'user') {
      if (!userSkillIds.includes(input.skillId)) {
        throw new Error(`skill-not-found: user:${input.skillId}`)
      }
    } else if (ws) {
      const { wsSkillIds } = await this.resolveWorkspaceSkillIds(ws, userSkillIds)
      if (!wsSkillIds.includes(input.skillId)) {
        throw new Error(`skill-not-found: workspace:${input.skillId}`)
      }
    }

    const userState = await readSkillEnablementState({
      runtime: {
        scope: ws ? 'workspace' : 'global',
        homeDirectory: home,
        ...(ws ? { workspaceDirectory: ws } : {}),
        vaultRoot: userVaultRoot,
        indexPath: userIndexPath,
        stateDirectory: join(ws ?? home, '.pmstudio', 'state'),
        detectedProviders: [],
        fileIO: this.fileIO
      },
      includeAgents: false
    })

    const resolutionMap = resolveEffectiveSkills({
      installed: [input.skillId],
      userDefaults: userState.userDefaults,
      projectOverrides: ws ? userState.projectOverrides : {},
      userAgentOverrides: userState.userAgentOverrides,
      projectAgentOverrides: ws ? userState.projectAgentOverrides : {},
      scope: ws ? 'workspace' : 'global',
      includeAgents: true
    })
    const resolution = resolutionMap.get(input.skillId)
    if (!resolution) {
      throw new Error(`skill-not-found: ${input.scope}:${input.skillId}`)
    }

    return {
      rowKey: `${input.scope}:${input.skillId}`,
      agents: resolution.agents ?? {},
      agentDetails: resolution.agentDetails ?? {}
    }
  }

  async rescanPlugins(): Promise<PluginsRescanOutput> {
    const activeWorkspace = await this.resolveActiveWorkspace()
    const result = await scanReadonlyPluginSkills({
      homeDirectory: this.options.homeDirectory,
      ...(activeWorkspace.workspaceDirectory
        ? { workspaceDirectory: activeWorkspace.workspaceDirectory }
        : {}),
      ...(this.options.pluginRoot ? { pluginRoot: this.options.pluginRoot } : {}),
      ...(this.options.etcCodexSkillsRoot
        ? { etcCodexSkillsRoot: this.options.etcCodexSkillsRoot }
        : {})
    })
    return {
      pluginSkills: truncatePluginDescriptions(result.skills),
      pluginScanError: null
    }
  }

  async mutateEnablement(input: SkillMutateInput): Promise<SkillMutateOutput> {
    const activeWorkspace = await this.resolveActiveWorkspace()
    const ws = activeWorkspace.workspaceDirectory
    if (input.writeScope === 'project' && !ws) {
      throw new Error('skill-enablement-workspace-required')
    }
    if (input.kind === 'inherit' && !ws) {
      throw new Error('skill-enablement-workspace-required')
    }

    const { pluginSkills, readonlyRoots } = await this.scanPluginsSafe(ws)
    const home = this.options.homeDirectory
    const userVaultRoot = userSkillVaultRoot(home)
    const userCanonicalRoot = join(home, '.agents', 'skills')
    const userVaultIds = await listDirectSubdirNames(userVaultRoot)
    const userInstalled = new Set(await listInstalledSkillIds(userVaultRoot, userCanonicalRoot))
    const wsVaultIds = ws ? await listDirectSubdirNames(projectSkillVaultRoot(ws)) : new Set<string>()
    const wsInstalled = ws
      ? new Set(await listInstalledSkillIds(projectSkillVaultRoot(ws), join(ws, '.agents', 'skills')))
      : new Set<string>()

    const pluginSkillMap = new Map(pluginSkills.map((p) => [p.id, p]))
    const detectedProviders = await this.detectProviders(ws)

    const userGroup: string[] = []
    const wsGroup: string[] = []
    const readonlyBlocked: SkillMutateConflictItem[] = []

    for (const skillId of input.skillIds) {
      const belongsToWorkspace =
        input.skillScope === 'workspace' ||
        (input.skillScope !== 'user' && (wsVaultIds.has(skillId) || (!userInstalled.has(skillId) && wsInstalled.has(skillId))))

      if (belongsToWorkspace && ws) {
        wsGroup.push(skillId)
      } else if (userInstalled.has(skillId)) {
        userGroup.push(skillId)
      } else {
        const pluginMatch = pluginSkillMap.get(skillId)
        if (pluginMatch) {
          readonlyBlocked.push({
            skillId,
            provider: pluginMatch.pluginName,
            rootPath: pluginMatch.skillDirectoryPath
          })
        } else {
          userGroup.push(skillId)
        }
      }
    }

    const conflicts: SkillMutateConflictItem[] = []
    const failed: { skillId: string; error: string }[] = []

    const executeGroup = async (
      skillIds: string[],
      runtime: SkillEnablementRuntimeInput,
      commandScope: 'user' | 'project'
    ): Promise<void> => {
      if (skillIds.length === 0) {
        return
      }
      const report = await this.coordinator.executePerSkill({
        scopeKey: `${runtime.scope}:${runtime.vaultRoot}`,
        items: skillIds,
        getSkillId: (id) => id,
        runItem: async (skillId) => {
          const command =
            input.kind === 'inherit'
              ? ({ kind: 'inherit', skillIds: [skillId] } as const)
              : ({
                  kind: input.kind,
                  skillIds: [skillId],
                  scope: commandScope,
                  ...(input.agents ? { agents: input.agents as Partial<Record<AgentId, boolean>> } : {})
                } as const)
          const res = await runSkillEnablementCommand({ command, runtime })
          conflicts.push(...res.conflicts)
          readonlyBlocked.push(...res.readonlyBlocked)
          return res
        }
      })
      for (const item of report.failed) {
        failed.push({ skillId: item.skillId, error: item.error })
      }
      for (const busyId of report.skippedBusy) {
        failed.push({ skillId: busyId, error: 'Skill operation is currently in progress' })
      }
      for (const roId of report.skippedReadonly) {
        readonlyBlocked.push({ skillId: roId, provider: 'readonly', rootPath: '' })
      }
    }

    if (userGroup.length > 0) {
      const preAdopt = await this.adoptCanonicalSkillsBeforeMutation({
        scope: 'user',
        skillIds: userGroup,
        vaultIds: userVaultIds,
        installedIds: userInstalled,
        home,
        readonlyRoots
      })
      conflicts.push(...preAdopt.conflicts)
      readonlyBlocked.push(...preAdopt.readonlyBlocked)
      failed.push(...preAdopt.failed)

      const effectiveRuntimeScope = input.writeScope === 'project' || input.kind === 'inherit' ? 'workspace' : 'global'
      await executeGroup(
        preAdopt.readySkillIds,
        {
          scope: effectiveRuntimeScope,
          homeDirectory: home,
          ...(effectiveRuntimeScope === 'workspace' && ws
            ? { workspaceDirectory: ws, canonicalRoot: null }
            : {}),
          vaultRoot: userVaultRoot,
          indexPath: userSkillVaultIndexPath(home),
          stateDirectory: join(
            effectiveRuntimeScope === 'workspace' && ws ? ws : home,
            '.pmstudio',
            'state'
          ),
          detectedProviders,
          readonlyRoots,
          fileIO: this.fileIO
        },
        input.kind === 'inherit' ? 'project' : input.writeScope
      )
    }

    if (wsGroup.length > 0 && ws) {
      const preAdopt = await this.adoptCanonicalSkillsBeforeMutation({
        scope: 'workspace',
        skillIds: wsGroup,
        vaultIds: wsVaultIds,
        installedIds: wsInstalled,
        home,
        ws,
        readonlyRoots
      })
      conflicts.push(...preAdopt.conflicts)
      readonlyBlocked.push(...preAdopt.readonlyBlocked)
      failed.push(...preAdopt.failed)

      await executeGroup(
        preAdopt.readySkillIds,
        {
          scope: 'workspace',
          homeDirectory: home,
          workspaceDirectory: ws,
          vaultRoot: projectSkillVaultRoot(ws),
          indexPath: projectSkillVaultIndexPath(ws),
          stateDirectory: join(ws, '.pmstudio', 'state'),
          canonicalRoot: null,
          detectedProviders,
          readonlyRoots,
          fileIO: this.fileIO
        },
        'project'
      )
    }

    const refreshed = await this.collectManagedAndAdoptable({
      workspaceDirectory: ws,
      readonlyRoots,
      includeAgents: true,
      includeAdoptable: false
    })
    const requestedSet = new Set(input.skillIds)
    const updatedSkills = refreshed.managedSkills
      .filter((item) => requestedSet.has(item.id))
      .map(omitAgentMatrix)

    const hasIssues = conflicts.length > 0 || readonlyBlocked.length > 0 || failed.length > 0
    if (failed.length > 0 && updatedSkills.length === 0) {
      throw new Error(failed.map((f) => `${f.skillId}: ${f.error}`).join('; '))
    }

    const issueSkillIds = new Set([
      ...conflicts.map((c) => c.skillId),
      ...readonlyBlocked.map((r) => r.skillId),
      ...failed.map((f) => f.skillId)
    ])
    const allRequestedHadIssues =
      hasIssues && input.skillIds.every((skillId) => issueSkillIds.has(skillId))

    return {
      status: !hasIssues ? 'applied' : allRequestedHadIssues ? 'conflict' : 'partial',
      updatedSkills,
      conflicts,
      readonlyBlocked,
      failed
    }
  }

  /**
   * Auto-adopt `canonical-unindexed` skills into their corresponding Vault before running
   * enablement commands so both global and project-override mutations resolve the Vault master.
   */
  private async adoptCanonicalSkillsBeforeMutation(input: {
    scope: SkillScopeKind
    skillIds: readonly string[]
    vaultIds: ReadonlySet<string>
    installedIds: ReadonlySet<string>
    home: string
    ws?: string
    readonlyRoots: readonly string[]
  }): Promise<{
    readySkillIds: string[]
    conflicts: SkillMutateConflictItem[]
    readonlyBlocked: SkillMutateConflictItem[]
    failed: { skillId: string; error: string }[]
  }> {
    const needsAdopt = input.skillIds.filter(
      (id) => !input.vaultIds.has(id) && input.installedIds.has(id)
    )
    const readySkillIds = input.skillIds.filter((id) => !needsAdopt.includes(id))
    const conflicts: SkillMutateConflictItem[] = []
    const readonlyBlocked: SkillMutateConflictItem[] = []
    const failed: { skillId: string; error: string }[] = []

    if (needsAdopt.length === 0) {
      return { readySkillIds, conflicts, readonlyBlocked, failed }
    }

    const baseDir = input.scope === 'user' ? input.home : input.ws!
    const vaultRoot =
      input.scope === 'user' ? userSkillVaultRoot(input.home) : projectSkillVaultRoot(input.ws!)
    const indexPath =
      input.scope === 'user'
        ? userSkillVaultIndexPath(input.home)
        : projectSkillVaultIndexPath(input.ws!)
    const canonicalRoot = join(baseDir, '.agents', 'skills')
    const index = await readSkillVaultIndexWithLegacyFallback(
      indexPath,
      input.scope === 'workspace' ? legacyProjectSkillVaultIndexPath(input.ws!) : undefined
    )
    const candidatePaths = await collectCandidatePathsForScope(
      input.scope === 'user' ? 'global' : 'workspace',
      baseDir
    )
    const scanPlan = await scanSkillVault({
      homeDirectory: input.home,
      vaultRoot,
      candidatePaths,
      index,
      readonlyRoots: input.readonlyRoots
    })
    const adoptById = new Map(adoptableSkillVaultItems(scanPlan).map((item) => [item.id, item]))
    const conflictById = new Map(
      scanPlan.items
        .filter((item) => item.disposition === 'conflict')
        .map((item) => [item.id, item])
    )

    for (const skillId of needsAdopt) {
      const conflictItem = conflictById.get(skillId)
      if (conflictItem) {
        conflicts.push({
          skillId,
          provider: 'vault-adopt',
          rootPath: conflictItem.originPath
        })
        continue
      }
      const adoptItem = adoptById.get(skillId)
      if (adoptItem) {
        try {
          await adoptSkillsIntoVault({
            homeDirectory: input.home,
            vaultRoot,
            indexPath,
            items: [adoptItem],
            readonlyRoots: input.readonlyRoots
          })
          readySkillIds.push(skillId)
        } catch (error) {
          failed.push({
            skillId,
            error: error instanceof Error ? error.message : String(error)
          })
        }
        continue
      }
      const canonicalCandidate = join(canonicalRoot, skillId)
      if (
        await isReadonlySkillTarget(canonicalCandidate, {
          readonlyRoots: input.readonlyRoots
        })
      ) {
        readonlyBlocked.push({
          skillId,
          provider: 'readonly',
          rootPath: canonicalCandidate
        })
      } else {
        failed.push({
          skillId,
          error: `skill-canonical-adopt-unavailable: ${skillId}`
        })
      }
    }

    return { readySkillIds, conflicts, readonlyBlocked, failed }
  }

  async adoptSkills(input: SkillAdoptInput): Promise<SkillAdoptOutput> {
    const activeWorkspace = await this.resolveActiveWorkspace()
    const ws = activeWorkspace.workspaceDirectory
    if (input.scope === 'workspace' && !ws) {
      throw new Error('skill-adopt-workspace-required')
    }
    const { readonlyRoots } = await this.scanPluginsSafe(ws)
    const home = this.options.homeDirectory
    const baseDir = input.scope === 'user' ? home : ws!
    const vaultRoot = input.scope === 'user' ? userSkillVaultRoot(home) : projectSkillVaultRoot(ws!)
    const indexPath = input.scope === 'user' ? userSkillVaultIndexPath(home) : projectSkillVaultIndexPath(ws!)
    const index = await readSkillVaultIndexWithLegacyFallback(
      indexPath,
      input.scope === 'workspace' ? legacyProjectSkillVaultIndexPath(ws!) : undefined
    )

    const candidatePaths = await collectCandidatePathsForScope(
      input.scope === 'user' ? 'global' : 'workspace',
      baseDir
    )
    const scanPlan = await scanSkillVault({
      homeDirectory: home,
      vaultRoot,
      candidatePaths,
      index,
      readonlyRoots
    })
    const requested = new Set(input.skillIds)
    const adoptItems = adoptableSkillVaultItems(scanPlan).filter((item) => requested.has(item.id))
    const conflictIds = scanPlan.items
      .filter((item) => item.disposition === 'conflict' && requested.has(item.id))
      .map((item) => item.id)

    if (adoptItems.length === 0) {
      return {
        adoptedIds: [],
        skippedReadonly: [],
        conflicts: conflictIds,
        failed: []
      }
    }

    const outcome = await adoptSkillsIntoVault({
      homeDirectory: home,
      vaultRoot,
      indexPath,
      items: adoptItems,
      readonlyRoots
    })

    return {
      adoptedIds: outcome.adopted.map((item) => item.id),
      skippedReadonly: [],
      conflicts: conflictIds,
      failed: []
    }
  }

  private async createPackService(scope: SkillPackScope): Promise<SkillPackService> {
    const activeWorkspace = await this.resolveActiveWorkspace()
    const ws = activeWorkspace.workspaceDirectory
    if (scope === 'project' && !ws) {
      throw new Error('skill-pack-project-required')
    }
    const home = this.options.homeDirectory
    const { pluginSkills, readonlyRoots } = await this.scanPluginsSafe(ws)
    const packsPath = skillPackFilePath(scope, home, ws)
    const vaultRoot = scope === 'user' ? userSkillVaultRoot(home) : projectSkillVaultRoot(ws!)
    const indexPath = scope === 'user' ? userSkillVaultIndexPath(home) : projectSkillVaultIndexPath(ws!)
    const canonicalRoot = join(scope === 'user' ? home : ws!, '.agents', 'skills')
    const detectedProviders = await this.detectProviders(ws)
    const pluginIdSet = new Set(pluginSkills.map((p) => p.id))

    const getRuntime = (): SkillEnablementRuntimeInput => ({
      scope: scope === 'user' ? 'global' : 'workspace',
      homeDirectory: home,
      ...(scope === 'project' && ws ? { workspaceDirectory: ws } : {}),
      vaultRoot,
      indexPath,
      stateDirectory: join(scope === 'user' ? home : ws!, '.pmstudio', 'state'),
      detectedProviders,
      readonlyRoots,
      fileIO: this.fileIO
    })

    return new SkillPackService(packsPath, {
      scope,
      getCurrent: async () => {
        const state = await readSkillEnablementState({ runtime: getRuntime() })
        const enabled = new Set<string>()
        for (const [id, res] of state.resolution.entries()) {
          if (res.effective === 'enabled') {
            enabled.add(id)
          }
        }
        return enabled
      },
      getInstalled: async () => {
        const ids = await listInstalledSkillIds(vaultRoot, canonicalRoot)
        return new Set(ids)
      },
      getEntries: async (): Promise<readonly SkillVaultEntryLike[]> => {
        const [index, state] = await Promise.all([
          readSkillVaultIndexWithLegacyFallback(
            indexPath,
            scope === 'project' ? legacyProjectSkillVaultIndexPath(ws!) : undefined
          ),
          readSkillEnablementState({ runtime: getRuntime(), includeAgents: true })
        ])
        const entryMap = new Map((index?.entries ?? []).map((entry) => [entry.id, entry]))
        return state.installedSkillIds.map((id) => {
          const entry = entryMap.get(id)
          const res = state.resolution.get(id)
          const enabledAgents = Object.entries(res?.agents ?? {})
            .filter(([, on]) => Boolean(on))
            .map(([agent]) => agent)
          return {
            id,
            name: entry?.name ?? id,
            sourceKind: entry?.sourceKind ?? 'installed',
            tags: entry?.tags ?? [],
            author: entry?.author ?? null,
            scope,
            agents: enabledAgents,
            ...(entry?.originPath ? { originRoot: entry.originPath } : {}),
            enabled: res?.effective === 'enabled',
            readonly: false
          }
        })
      },
      isReadonlySkillId: async (id) => {
        const installed = new Set(await listInstalledSkillIds(vaultRoot, canonicalRoot))
        return !installed.has(id) && pluginIdSet.has(id)
      },
      onApplyDiff: async (plan: SkillPackPreview) => {
        const runtime = getRuntime()
        const disableIds = [...plan.disable]
        const enableIds = [...plan.enable]
        if (disableIds.length > 0) {
          await runSkillEnablementCommand({
            command: { kind: 'disable', skillIds: disableIds, scope },
            runtime
          })
        }
        if (enableIds.length > 0) {
          await runSkillEnablementCommand({
            command: { kind: 'enable', skillIds: enableIds, scope },
            runtime
          })
        }
        return { enabled: enableIds, disabled: disableIds }
      }
    })
  }

  async listPacks(scope: SkillPackScope): Promise<PackListOutput> {
    const service = await this.createPackService(scope)
    const [result, undoSnapshots] = await Promise.all([
      service.list(),
      service.listUndoSnapshots()
    ])
    return {
      scope,
      entries: result.entries,
      undoSnapshots: [...undoSnapshots].reverse(),
      error: result.error
    }
  }

  async saveCurrentPack(input: {
    scope: SkillPackScope
    id: string
    name: string
    description?: string
  }): Promise<SkillPackV2> {
    const service = await this.createPackService(input.scope)
    return service.saveCurrent({
      id: input.id,
      name: input.name,
      ...(input.description ? { description: input.description } : {})
    })
  }

  async savePack(input: { scope: SkillPackScope; pack: SkillPackV2 }): Promise<SkillPackV2> {
    const service = await this.createPackService(input.scope)
    return service.save(input.pack)
  }

  async deletePack(input: { scope: SkillPackScope; id: string }): Promise<{ deleted: boolean }> {
    const service = await this.createPackService(input.scope)
    const deleted = await service.delete(input.id)
    return { deleted }
  }

  async previewPack(input: {
    scope: SkillPackScope
    id: string
    mode: SkillPackOperationMode
  }): Promise<PackPreviewOutput> {
    const service = await this.createPackService(input.scope)
    const res = await service.preview(input.id, input.mode)
    return {
      id: input.id,
      mode: input.mode,
      diff: res.diff,
      ...(res.hitIds ? { hitIds: res.hitIds } : {})
    }
  }

  async applyPack(input: {
    scope: SkillPackScope
    id: string
    mode: SkillPackOperationMode
  }): Promise<PackApplyOutput> {
    const service = await this.createPackService(input.scope)
    const res = await service.apply(input.id, input.mode, false)
    return {
      id: input.id,
      mode: input.mode,
      diff: {
        enable: [...res.preview.enable],
        disable: [...res.preview.disable],
        keep: [...res.preview.keep],
        missing: [...res.preview.missing]
      },
      ...(res.undoId ? { undoId: res.undoId } : {}),
      ...(res.hitIds ? { hitIds: res.hitIds } : {})
    }
  }

  async rollbackPack(input: {
    scope: SkillPackScope
    undoId?: string
  }): Promise<PackRollbackOutput> {
    const service = await this.createPackService(input.scope)
    const res = await service.rollback(input.undoId)
    return { snapshot: res.snapshot }
  }

  async exportPack(input: { scope: SkillPackScope; id: string }): Promise<SkillPackExportBundle> {
    const service = await this.createPackService(input.scope)
    return service.exportPack(input.id)
  }

  async importPack(input: {
    scope: SkillPackScope
    bundle: SkillPackExportBundle
    conflictStrategy?: 'overwrite' | 'rename' | 'reject'
  }): Promise<PackImportOutput> {
    const service = await this.createPackService(input.scope)
    return service.importPack(input.bundle, {
      ...(input.conflictStrategy ? { conflictStrategy: input.conflictStrategy } : {})
    })
  }

  async runAudit(requestedScope?: SkillPackScope): Promise<SkillAuditReport> {
    const activeWorkspace = await this.resolveActiveWorkspace()
    const ws = activeWorkspace.workspaceDirectory
    const effectiveScope: 'global' | 'workspace' =
      requestedScope === 'project' && ws ? 'workspace' : 'global'
    const home = this.options.homeDirectory
    const { pluginSkills, readonlyRoots } = await this.scanPluginsSafe(ws)
    const vaultRoot =
      effectiveScope === 'global' ? userSkillVaultRoot(home) : projectSkillVaultRoot(ws!)
    const indexPath =
      effectiveScope === 'global' ? userSkillVaultIndexPath(home) : projectSkillVaultIndexPath(ws!)
    const vaultIndex = await readSkillVaultIndexWithLegacyFallback(
      indexPath,
      effectiveScope === 'workspace' ? legacyProjectSkillVaultIndexPath(ws!) : undefined
    )
    return auditSkillsHealth({
      scope: effectiveScope,
      homeDirectory: home,
      ...(ws ? { workspaceDirectory: ws } : {}),
      vaultRoot,
      vaultIndex,
      pluginSkills,
      readonlyRoots
    })
  }
}
