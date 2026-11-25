import type { TuiAgent } from './tui-agent'

export type SkillAuditFindingKind =
  | 'orphan-symlink'
  | 'duplicate-same-digest'
  | 'digest-conflict'
  | 'copy-drifted'
  | 'copy-outdated'
  | 'retired-install-root'
  | 'readonly-plugin-exposure'
  | 'plugin-name-collision'

export type SkillAuditSeverity = 'info' | 'warning' | 'error'

export type SkillAuditFinding = {
  kind: SkillAuditFindingKind
  severity: SkillAuditSeverity
  skillId: string
  path: string
  agent?: TuiAgent
  targetPath?: string
  message: string
}

export type SkillAuditSummary = {
  totalFindings: number
  orphanSymlinks: number
  duplicates: number
  conflicts: number
  copyDrifted: number
  copyOutdated: number
  retiredRoots: number
  readonlyPluginExposures: number
  pluginCollisions: number
  pluginSkillsTotal: number
  pluginSkillsActive: number
}

export type SkillAuditReport = {
  readonly auditedAt: string
  readonly findings: SkillAuditFinding[]
  readonly summary: SkillAuditSummary
}
