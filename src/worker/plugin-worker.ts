import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PackIdInputSchema,
  PackImportInputSchema,
  PackModeInputSchema,
  PackRollbackInputSchema,
  PackSaveCurrentInputSchema,
  PackSaveInputSchema,
  PackScopeInputSchema,
  SKILL_BRIDGE_EVENTS,
  SKILL_BRIDGE_METHODS,
  SkillAdoptInputSchema,
  SkillAgentMatrixInputSchema,
  SkillMutateInputSchema
} from '../contracts/skill-ui-bridge-contract'
import {
  SkillsWorkerService,
  type HostContextPayload,
  type HostWorkspaceRow
} from './skills-worker-service'

type Disposable = { dispose(): void }

export type OrcaWorkerLike = {
  host: {
    call(method: string, params?: unknown): Promise<unknown>
    has(method: string): boolean
  }
  events: {
    on(event: string, handler: (payload: unknown) => void): Disposable
  }
  panels: {
    handle(
      name: string,
      handler: (input: unknown, context?: { signal?: AbortSignal }) => Promise<unknown> | unknown
    ): Disposable
    post(event: string, payload?: unknown): void
  }
  log?(message: string): void
}

function resolvePluginRoot(): string | undefined {
  try {
    const currentFile = fileURLToPath(import.meta.url)
    return resolve(dirname(currentFile), '..')
  } catch {
    return undefined
  }
}

export default function activate(orca: OrcaWorkerLike): () => void {
  const service = new SkillsWorkerService({
    homeDirectory: homedir(),
    pluginRoot: resolvePluginRoot(),
    hostBridge: {
      readWorkspaceContext: async () =>
        (await orca.host.call('workspace.readContext')) as HostContextPayload,
      listWorkspaces: async () => {
        const res = (await orca.host.call('workspace.list')) as {
          workspaces?: HostWorkspaceRow[]
        } | null
        return { workspaces: res?.workspaces ?? [] }
      }
    }
  })

  const disposables: Disposable[] = []

  const broadcastSkillsChanged = (writeScope: 'user' | 'project', skillIds: string[]): void => {
    orca.panels.post(SKILL_BRIDGE_EVENTS.skillsChanged, {
      writeScope,
      skillIds,
      updatedAt: Date.now()
    })
  }

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.workbenchSnapshot, () =>
      service.getWorkbenchSnapshot()
    )
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.panelSnapshot, () => service.getQuickPanelSnapshot())
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.skillAgentMatrix, async (rawInput) => {
      const parsed = SkillAgentMatrixInputSchema.parse(rawInput)
      return service.getSkillAgentMatrix(parsed)
    })
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.pluginsRescan, () => service.rescanPlugins())
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.enablementMutate, async (rawInput) => {
      const parsed = SkillMutateInputSchema.parse(rawInput)
      const result = await service.mutateEnablement(parsed)
      broadcastSkillsChanged(parsed.writeScope, parsed.skillIds)
      return result
    })
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.vaultAdopt, async (rawInput) => {
      const parsed = SkillAdoptInputSchema.parse(rawInput)
      const result = await service.adoptSkills(parsed)
      broadcastSkillsChanged(parsed.scope === 'user' ? 'user' : 'project', result.adoptedIds)
      return result
    })
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.packsList, (rawInput) => {
      const parsed = PackScopeInputSchema.parse(rawInput)
      return service.listPacks(parsed.scope)
    })
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.packsSaveCurrent, async (rawInput) => {
      const parsed = PackSaveCurrentInputSchema.parse(rawInput)
      const saved = await service.saveCurrentPack(parsed)
      broadcastSkillsChanged(parsed.scope, [])
      return saved
    })
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.packsSave, async (rawInput) => {
      const parsed = PackSaveInputSchema.parse(rawInput)
      const saved = await service.savePack(parsed)
      broadcastSkillsChanged(parsed.scope, [])
      return saved
    })
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.packsDelete, async (rawInput) => {
      const parsed = PackIdInputSchema.parse(rawInput)
      const res = await service.deletePack(parsed)
      broadcastSkillsChanged(parsed.scope, [])
      return res
    })
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.packsPreview, (rawInput) => {
      const parsed = PackModeInputSchema.parse(rawInput)
      return service.previewPack(parsed)
    })
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.packsApply, async (rawInput) => {
      const parsed = PackModeInputSchema.parse(rawInput)
      const result = await service.applyPack(parsed)
      broadcastSkillsChanged(parsed.scope, [...result.diff.enable, ...result.diff.disable])
      return result
    })
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.packsRollback, async (rawInput) => {
      const parsed = PackRollbackInputSchema.parse(rawInput)
      const result = await service.rollbackPack(parsed)
      broadcastSkillsChanged(parsed.scope, result.snapshot.affectedSkillIds)
      return result
    })
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.packsExport, (rawInput) => {
      const parsed = PackIdInputSchema.parse(rawInput)
      return service.exportPack(parsed)
    })
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.packsImport, async (rawInput) => {
      const parsed = PackImportInputSchema.parse(rawInput)
      const result = await service.importPack(parsed)
      broadcastSkillsChanged(parsed.scope, [])
      return result
    })
  )

  disposables.push(
    orca.panels.handle(SKILL_BRIDGE_METHODS.auditRun, (rawInput) => {
      const scope =
        rawInput && typeof rawInput === 'object' && 'scope' in rawInput
          ? PackScopeInputSchema.parse(rawInput).scope
          : undefined
      return service.runAudit(scope)
    })
  )

  let firstWorkspaceReplay = true
  disposables.push(
    orca.events.on('workspace.changed', () => {
      if (firstWorkspaceReplay) {
        firstWorkspaceReplay = false
        return
      }
      void service
        .resolveActiveWorkspace()
        .then((ws) => {
          orca.panels.post(SKILL_BRIDGE_EVENTS.contextChanged, {
            workspaceId: ws.workspaceId,
            workspaceName: ws.workspaceName,
            isLocalDirectoryAvailable: ws.isLocalDirectoryAvailable
          })
        })
        .catch(() => undefined)
    })
  )

  return () => {
    for (const disposable of disposables.splice(0)) {
      disposable.dispose()
    }
  }
}
