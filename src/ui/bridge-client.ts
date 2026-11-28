import {
  SKILL_BRIDGE_EVENTS,
  SKILL_BRIDGE_METHODS,
  type AuditRunOutput,
  type PackApplyOutput,
  type PackExportOutput,
  type PackImportOutput,
  type PackListOutput,
  type PackPreviewOutput,
  type PackRollbackOutput,
  type PluginsRescanOutput,
  type QuickPanelSnapshotOutput,
  type SkillAdoptInput,
  type SkillAdoptOutput,
  type SkillAgentMatrixInput,
  type SkillAgentMatrixOutput,
  type SkillMutateInput,
  type SkillMutateOutput,
  type SkillsChangedPayload,
  type WorkbenchSnapshotOutput,
  type WorkspaceContextSummary
} from '../contracts/skill-ui-bridge-contract'
import type {
  SkillPackOperationMode,
  SkillPackScope,
  SkillPackV2
} from '../contracts/skill-pack-contract'
import type { OrcaDisposable, OrcaFrameApi } from './orca-frame-types'

export class BridgeUnavailableError extends Error {
  readonly code = 'bridge_unavailable'
  constructor(message = 'Orca plugin bridge (window.orca) is unavailable in this context') {
    super(message)
    this.name = 'BridgeUnavailableError'
  }
}

export function formatBridgeError(error: unknown): string {
  if (error instanceof BridgeUnavailableError) {
    return error.message
  }
  if (error && typeof error === 'object') {
    const errObj = error as { code?: unknown; message?: unknown }
    const msg = typeof errObj.message === 'string' && errObj.message.trim() ? errObj.message.trim() : null
    const code = typeof errObj.code === 'string' && errObj.code.trim() ? errObj.code.trim() : null
    if (msg && code && !msg.includes(code)) {
      return `${msg} (${code})`
    }
    if (msg) {
      return msg
    }
  }
  return String(error || 'Unknown bridge error')
}

function getOrca(): OrcaFrameApi {
  const orca = typeof window !== 'undefined' ? window.orca : undefined
  if (!orca || !orca.plugin || typeof orca.plugin.request !== 'function') {
    throw new BridgeUnavailableError()
  }
  return orca
}

export const bridgeClient = {
  getWorkbenchSnapshot(): Promise<WorkbenchSnapshotOutput> {
    return getOrca().plugin.request<WorkbenchSnapshotOutput>(
      SKILL_BRIDGE_METHODS.workbenchSnapshot
    )
  },

  getPanelSnapshot(): Promise<QuickPanelSnapshotOutput> {
    return getOrca().plugin.request<QuickPanelSnapshotOutput>(SKILL_BRIDGE_METHODS.panelSnapshot)
  },

  rescanPlugins(): Promise<PluginsRescanOutput> {
    return getOrca().plugin.request<PluginsRescanOutput>(SKILL_BRIDGE_METHODS.pluginsRescan)
  },

  getSkillAgentMatrix(input: SkillAgentMatrixInput): Promise<SkillAgentMatrixOutput> {
    return getOrca().plugin.request<SkillAgentMatrixOutput>(
      SKILL_BRIDGE_METHODS.skillAgentMatrix,
      input
    )
  },

  mutateEnablement(input: SkillMutateInput): Promise<SkillMutateOutput> {
    return getOrca().plugin.request<SkillMutateOutput>(
      SKILL_BRIDGE_METHODS.enablementMutate,
      input,
      { timeoutMs: 60_000 }
    )
  },

  adoptSkills(input: SkillAdoptInput): Promise<SkillAdoptOutput> {
    return getOrca().plugin.request<SkillAdoptOutput>(SKILL_BRIDGE_METHODS.vaultAdopt, input, {
      timeoutMs: 60_000
    })
  },

  listPacks(scope: SkillPackScope): Promise<PackListOutput> {
    return getOrca().plugin.request<PackListOutput>(SKILL_BRIDGE_METHODS.packsList, { scope })
  },

  saveCurrentPack(input: {
    scope: SkillPackScope
    id: string
    name: string
    description?: string
  }): Promise<SkillPackV2> {
    return getOrca().plugin.request<SkillPackV2>(SKILL_BRIDGE_METHODS.packsSaveCurrent, input)
  },

  savePack(input: { scope: SkillPackScope; pack: SkillPackV2 }): Promise<SkillPackV2> {
    return getOrca().plugin.request<SkillPackV2>(SKILL_BRIDGE_METHODS.packsSave, input)
  },

  deletePack(input: { scope: SkillPackScope; id: string }): Promise<{ deleted: boolean }> {
    return getOrca().plugin.request<{ deleted: boolean }>(SKILL_BRIDGE_METHODS.packsDelete, input)
  },

  previewPack(input: {
    scope: SkillPackScope
    id: string
    mode: SkillPackOperationMode
  }): Promise<PackPreviewOutput> {
    return getOrca().plugin.request<PackPreviewOutput>(SKILL_BRIDGE_METHODS.packsPreview, input)
  },

  applyPack(input: {
    scope: SkillPackScope
    id: string
    mode: SkillPackOperationMode
  }): Promise<PackApplyOutput> {
    return getOrca().plugin.request<PackApplyOutput>(SKILL_BRIDGE_METHODS.packsApply, input, {
      timeoutMs: 60_000
    })
  },

  rollbackPack(input: { scope: SkillPackScope; undoId?: string }): Promise<PackRollbackOutput> {
    return getOrca().plugin.request<PackRollbackOutput>(SKILL_BRIDGE_METHODS.packsRollback, input, {
      timeoutMs: 60_000
    })
  },

  exportPack(input: { scope: SkillPackScope; id: string }): Promise<PackExportOutput> {
    return getOrca().plugin.request<PackExportOutput>(SKILL_BRIDGE_METHODS.packsExport, input)
  },

  importPack(input: {
    scope: SkillPackScope
    bundle: PackExportOutput
    conflictStrategy?: 'overwrite' | 'rename' | 'reject'
  }): Promise<PackImportOutput> {
    return getOrca().plugin.request<PackImportOutput>(SKILL_BRIDGE_METHODS.packsImport, input)
  },

  runAudit(scope?: SkillPackScope): Promise<AuditRunOutput> {
    return getOrca().plugin.request<AuditRunOutput>(
      SKILL_BRIDGE_METHODS.auditRun,
      scope ? { scope } : undefined
    )
  },

  openWorkbenchPage(): Promise<{ opened?: boolean }> {
    const orca = getOrca()
    if (!orca.navigation || typeof orca.navigation.openPage !== 'function') {
      throw new BridgeUnavailableError('Orca navigation.openPage API is unavailable')
    }
    return orca.navigation.openPage('skills-workbench')
  },

  async saveJsonFile(suggestedName: string, content: string): Promise<'saved' | 'copied' | 'cancelled'> {
    const orca = getOrca()
    if (orca.files && typeof orca.files.saveAs === 'function') {
      const res = await orca.files.saveAs({
        data: content,
        suggestedName,
        mimeType: 'application/json'
      })
      return res.status
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(content)
      return 'copied'
    }
    throw new Error('No file save or clipboard API available')
  },

  onSkillsChanged(handler: (payload: SkillsChangedPayload) => void): OrcaDisposable {
    return getOrca().plugin.on(SKILL_BRIDGE_EVENTS.skillsChanged, (payload) => {
      handler(payload as SkillsChangedPayload)
    })
  },

  onContextChanged(handler: (payload: WorkspaceContextSummary) => void): OrcaDisposable {
    return getOrca().plugin.on(SKILL_BRIDGE_EVENTS.contextChanged, (payload) => {
      handler(payload as WorkspaceContextSummary)
    })
  }
}
