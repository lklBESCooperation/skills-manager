import { z } from 'zod'
import type { PluginSkillRecord } from './plugin-skill-contract'
import type { SkillAuditReport } from './skill-audit-contract'
import type {
  AgentId,
  EffectiveAgentSkillState,
  EffectiveSkillState,
  SkillEnablementOrigin
} from './skill-enablement'
import {
  SkillPackExportBundleSchema,
  SkillPackOperationModeSchema,
  SkillPackV2Schema,
  type SkillPackExportBundle,
  type SkillPackOperationMode,
  type SkillPackPreviewDiff,
  type SkillPackScope,
  type SkillPackUndoSnapshot,
  type SkillPackV2
} from './skill-pack-contract'
import type { CopyModePlacementState } from './skill-vault-contract'
import { TUI_AGENTS } from './tui-agent'

export const SKILL_BRIDGE_METHODS = {
  workbenchSnapshot: 'skills.workbench.snapshot',
  panelSnapshot: 'skills.panel.snapshot',
  skillAgentMatrix: 'skills.skill.agentMatrix',
  enablementMutate: 'skills.enablement.mutate',
  pluginsRescan: 'skills.plugins.rescan',
  vaultAdopt: 'skills.vault.adopt',
  packsList: 'skills.packs.list',
  packsSaveCurrent: 'skills.packs.saveCurrent',
  packsSave: 'skills.packs.save',
  packsDelete: 'skills.packs.delete',
  packsPreview: 'skills.packs.preview',
  packsApply: 'skills.packs.apply',
  packsRollback: 'skills.packs.rollback',
  packsExport: 'skills.packs.export',
  packsImport: 'skills.packs.import',
  auditRun: 'skills.audit.run'
} as const

export const SKILL_BRIDGE_EVENTS = {
  skillsChanged: 'skills.changed',
  contextChanged: 'skills.contextChanged'
} as const

export type ManagedSkillSourceKind =
  | 'installed'
  | 'adopted'
  | 'bundled'
  | 'canonical-unindexed'

export type SkillScopeKind = 'user' | 'workspace'

export type WorkspaceContextSummary = {
  workspaceId: string | null
  workspaceName: string | null
  /** Only true when focused workspace is local (`hostId === null || hostId === 'local'`). */
  isLocalDirectoryAvailable: boolean
}

export type AgentRegistrySummaryItem = {
  id: AgentId
  displayName: string
  capability: 'managed' | 'discovery-only' | 'delegate' | 'unsupported'
  readsCanonical: boolean
  delegatesTo?: AgentId
}

export type ManagedSkillViewItem = {
  /** Stable unique row key (`${scope}:${id}`). */
  rowKey: string
  id: string
  name: string
  description: string | null
  sourceKind: ManagedSkillSourceKind
  scope: SkillScopeKind
  tags: string[]
  author: string | null
  copyMode: boolean
  copyModeState?: CopyModePlacementState
  effective: EffectiveSkillState
  origin: SkillEnablementOrigin
  enabledAgentCount: number
  supportedAgentCount: number
  agents?: Partial<Record<AgentId, boolean>>
  agentDetails?: Partial<Record<AgentId, EffectiveAgentSkillState>>
}

export type AdoptableSkillViewItem = {
  rowKey: string
  id: string
  name: string
  description: string | null
  scope: SkillScopeKind
  disposition: 'adoptable' | 'conflict'
  digest: string
  originPath: string
  mergePaths: string[]
  conflictCount: number
}

export type WorkbenchSnapshotOutput = {
  activeWorkspace: WorkspaceContextSummary
  agentRegistry: AgentRegistrySummaryItem[]
  managedSkills: ManagedSkillViewItem[]
  adoptableSkills: AdoptableSkillViewItem[]
  pluginSkills: PluginSkillRecord[]
  pluginScanError: string | null
  generatedAt: number
}

export type QuickPanelSkillItem = Omit<ManagedSkillViewItem, 'agents' | 'agentDetails'>

export type QuickPanelSnapshotOutput = {
  activeWorkspace: WorkspaceContextSummary
  managedSkills: QuickPanelSkillItem[]
  pluginSkillCount: number
  adoptableCount: number
  generatedAt: number
}

export const SkillAgentMatrixInputSchema = z
  .object({
    skillId: z.string().min(1).max(128),
    scope: z.enum(['user', 'workspace'])
  })
  .strict()

export type SkillAgentMatrixInput = z.infer<typeof SkillAgentMatrixInputSchema>

export type SkillAgentMatrixOutput = {
  rowKey: string
  agents: Partial<Record<AgentId, boolean>>
  agentDetails: Partial<Record<AgentId, EffectiveAgentSkillState>>
}

const AgentIdSchema = z.enum(TUI_AGENTS)

export const SkillMutateInputSchema = z
  .object({
    kind: z.enum(['enable', 'disable', 'inherit']),
    skillIds: z.array(z.string().min(1).max(128)).min(1),
    writeScope: z.enum(['user', 'project']),
    skillScope: z.enum(['user', 'workspace']).optional(),
    agents: z.partialRecord(AgentIdSchema, z.boolean()).optional()
  })
  .strict()

export type SkillMutateInput = z.infer<typeof SkillMutateInputSchema>

export type SkillMutateConflictItem = {
  skillId: string
  provider: string
  rootPath: string
}

export type SkillMutateOutput = {
  status: 'applied' | 'partial' | 'conflict'
  updatedSkills: ManagedSkillViewItem[]
  conflicts: SkillMutateConflictItem[]
  readonlyBlocked: SkillMutateConflictItem[]
  failed: { skillId: string; error: string }[]
}

export const SkillAdoptInputSchema = z
  .object({
    scope: z.enum(['user', 'workspace']),
    skillIds: z.array(z.string().min(1).max(128)).min(1)
  })
  .strict()

export type SkillAdoptInput = z.infer<typeof SkillAdoptInputSchema>

export type SkillAdoptOutput = {
  adoptedIds: string[]
  skippedReadonly: string[]
  conflicts: string[]
  failed: { skillId: string; error: string }[]
}

export const PackScopeInputSchema = z
  .object({
    scope: z.enum(['user', 'project'])
  })
  .strict()

export const PackSaveCurrentInputSchema = z
  .object({
    scope: z.enum(['user', 'project']),
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1).max(128),
    description: z.string().max(512).optional()
  })
  .strict()

export const PackSaveInputSchema = z
  .object({
    scope: z.enum(['user', 'project']),
    pack: SkillPackV2Schema
  })
  .strict()

export const PackIdInputSchema = z
  .object({
    scope: z.enum(['user', 'project']),
    id: z.string().min(1).max(128)
  })
  .strict()

export const PackModeInputSchema = z
  .object({
    scope: z.enum(['user', 'project']),
    id: z.string().min(1).max(128),
    mode: SkillPackOperationModeSchema
  })
  .strict()

export const PackRollbackInputSchema = z
  .object({
    scope: z.enum(['user', 'project']),
    undoId: z.string().min(1).optional()
  })
  .strict()

export const PackImportInputSchema = z
  .object({
    scope: z.enum(['user', 'project']),
    bundle: SkillPackExportBundleSchema,
    conflictStrategy: z.enum(['overwrite', 'rename', 'reject']).optional()
  })
  .strict()

export type PackListEntryView = {
  pack: SkillPackV2
  missing: string[]
}

export type PackListOutput = {
  scope: SkillPackScope
  entries: PackListEntryView[]
  undoSnapshots: SkillPackUndoSnapshot[]
  error: string | null
}

export type PackPreviewOutput = {
  id: string
  mode: SkillPackOperationMode
  diff: SkillPackPreviewDiff
  hitIds?: string[]
}

export type PackApplyOutput = {
  id: string
  mode: SkillPackOperationMode
  diff: SkillPackPreviewDiff
  undoId?: string
  hitIds?: string[]
}

export type PackRollbackOutput = {
  snapshot: SkillPackUndoSnapshot
}

export type PackImportOutput = {
  pack: SkillPackV2
  missing: string[]
}

export type PackExportOutput = SkillPackExportBundle

export type SkillsChangedPayload = {
  writeScope: 'user' | 'project'
  skillIds: string[]
  updatedAt: number
}

export type PluginsRescanOutput = {
  pluginSkills: PluginSkillRecord[]
  pluginScanError: string | null
}

export type AuditRunOutput = SkillAuditReport
