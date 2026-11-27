import type { PluginSkillRecord } from '../contracts/plugin-skill-contract'
import type {
  AdoptableSkillViewItem,
  ManagedSkillViewItem,
  QuickPanelSkillItem,
  SkillMutateOutput
} from '../contracts/skill-ui-bridge-contract'

export type ScopeFilter = 'all' | 'user' | 'workspace'
export type StatusFilter = 'all' | 'enabled' | 'disabled'

export type WorkbenchFilterCriteria = {
  query: string
  scope: ScopeFilter
  status: StatusFilter
}

export const DEFAULT_WORKBENCH_FILTERS: WorkbenchFilterCriteria = {
  query: '',
  scope: 'all',
  status: 'all'
}

export function hasActiveFilters(filters: WorkbenchFilterCriteria): boolean {
  return (
    filters.query.trim().length > 0 || filters.scope !== 'all' || filters.status !== 'all'
  )
}

export function filterManagedSkills<T extends QuickPanelSkillItem>(
  skills: readonly T[],
  filters: WorkbenchFilterCriteria
): T[] {
  const needle = filters.query.trim().toLowerCase()
  return skills.filter((item) => {
    if (filters.scope !== 'all' && item.scope !== filters.scope) {
      return false
    }
    if (filters.status !== 'all' && item.effective !== filters.status) {
      return false
    }
    if (!needle) {
      return true
    }
    const haystacks = [
      item.id,
      item.name,
      item.description ?? '',
      item.author ?? '',
      item.sourceKind,
      ...item.tags
    ]
    return haystacks.some((value) => value.toLowerCase().includes(needle))
  })
}

export function filterAdoptableSkills(
  skills: readonly AdoptableSkillViewItem[],
  filters: Pick<WorkbenchFilterCriteria, 'query' | 'scope'>
): AdoptableSkillViewItem[] {
  const needle = filters.query.trim().toLowerCase()
  return skills.filter((item) => {
    if (filters.scope !== 'all' && item.scope !== filters.scope) {
      return false
    }
    if (!needle) {
      return true
    }
    return [item.id, item.name, item.description ?? '', item.originPath].some((value) =>
      value.toLowerCase().includes(needle)
    )
  })
}

export function filterPluginSkills(
  skills: readonly PluginSkillRecord[],
  query: string
): PluginSkillRecord[] {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return [...skills]
  }
  return skills.filter((item) =>
    [
      item.id,
      item.name,
      item.description ?? '',
      item.pluginName,
      item.pluginId,
      item.marketplace ?? '',
      item.agent,
      item.invocationCommand ?? ''
    ].some((value) => value.toLowerCase().includes(needle))
  )
}

export function applyOptimisticMutation<T extends QuickPanelSkillItem>(
  skills: readonly T[],
  targetRowKeys: ReadonlySet<string>,
  nextState: 'enabled' | 'disabled',
  writeScope: 'user' | 'project'
): { nextSkills: T[]; rollbackSnapshot: Map<string, T> } {
  const rollbackSnapshot = new Map<string, T>()
  const nextSkills = skills.map((item) => {
    if (!targetRowKeys.has(item.rowKey)) {
      return item
    }
    rollbackSnapshot.set(item.rowKey, item)
    return {
      ...item,
      effective: nextState,
      origin: writeScope
    }
  })
  return { nextSkills, rollbackSnapshot }
}

export function rollbackOptimisticMutation<T extends QuickPanelSkillItem>(
  skills: readonly T[],
  rollbackSnapshot: ReadonlyMap<string, T>
): T[] {
  if (rollbackSnapshot.size === 0) {
    return [...skills]
  }
  return skills.map((item) => rollbackSnapshot.get(item.rowKey) ?? item)
}

export function reconcileMutatedSkills(
  skills: readonly ManagedSkillViewItem[],
  updatedSkills: readonly ManagedSkillViewItem[],
  rollbackSnapshot?: ReadonlyMap<string, ManagedSkillViewItem>,
  failedSkillIds?: ReadonlySet<string>
): ManagedSkillViewItem[] {
  return reconcileMutationResult(
    skills,
    updatedSkills,
    rollbackSnapshot,
    failedSkillIds,
    (item) => item
  )
}

export function reconcileQuickPanelSkills(
  skills: readonly QuickPanelSkillItem[],
  updatedSkills: readonly ManagedSkillViewItem[],
  rollbackSnapshot?: ReadonlyMap<string, QuickPanelSkillItem>,
  failedSkillIds?: ReadonlySet<string>
): QuickPanelSkillItem[] {
  return reconcileMutationResult(
    skills,
    updatedSkills,
    rollbackSnapshot,
    failedSkillIds,
    ({ agents: _a, agentDetails: _d, ...rest }) => rest
  )
}

function reconcileMutationResult<T extends QuickPanelSkillItem>(
  skills: readonly T[],
  updatedSkills: readonly ManagedSkillViewItem[],
  rollbackSnapshot: ReadonlyMap<string, T> | undefined,
  failedSkillIds: ReadonlySet<string> | undefined,
  toItem: (skill: ManagedSkillViewItem) => T
): T[] {
  const updatedByKey = new Map<string, T>(
    updatedSkills.map((skill) => {
      const mapped = toItem(skill)
      return [mapped.rowKey, mapped]
    })
  )
  return skills.map((item) => {
    const serverItem = updatedByKey.get(item.rowKey)
    if (serverItem) {
      return serverItem
    }
    if (failedSkillIds?.has(item.id) && rollbackSnapshot?.has(item.rowKey)) {
      return rollbackSnapshot.get(item.rowKey)!
    }
    return item
  })
}

export type MutationFeedbackSummary =
  | { kind: 'success' }
  | { kind: 'warn'; message: string }
  | { kind: 'error'; message: string }

export function summarizeMutationFeedback(
  results: readonly Pick<SkillMutateOutput, 'conflicts' | 'readonlyBlocked' | 'failed'>[],
  targetLabel?: string
): MutationFeedbackSummary {
  const conflicts: string[] = []
  const readonlyBlocked: string[] = []
  const failed: string[] = []

  for (const res of results) {
    for (const c of res.conflicts) {
      conflicts.push(`${c.skillId} (${c.provider}: ${c.rootPath})`)
    }
    for (const r of res.readonlyBlocked) {
      readonlyBlocked.push(`${r.skillId} (${r.provider})`)
    }
    for (const f of res.failed) {
      failed.push(`${f.skillId}: ${f.error}`)
    }
  }

  const issueParts: string[] = []
  if (failed.length > 0) {
    issueParts.push(`操作失败：${failed.join('；')}`)
  }
  if (conflicts.length > 0) {
    issueParts.push(`存在未纳管同名目录冲突，未覆盖原有目录：${conflicts.join('；')}`)
  }
  if (readonlyBlocked.length > 0) {
    issueParts.push(`只读插件路径已拦截保护：${readonlyBlocked.join('；')}`)
  }

  if (failed.length > 0) {
    const prefix = targetLabel ? `切换 ${targetLabel} 状态失败，已回滚至原状态：` : ''
    return {
      kind: 'error',
      message: `${prefix}${issueParts.join(' | ')}`
    }
  }
  if (issueParts.length > 0) {
    return {
      kind: 'warn',
      message: issueParts.join(' | ')
    }
  }
  return { kind: 'success' }
}

export function formatSourceKindLabel(kind: ManagedSkillViewItem['sourceKind']): string {
  switch (kind) {
    case 'installed':
      return '在线/仓库安装'
    case 'adopted':
      return '本地纳管'
    case 'bundled':
      return '内置受管'
    case 'canonical-unindexed':
      return '共享目录 (.agents/skills)'
  }
}

export function formatPluginActivationLabel(
  state: PluginSkillRecord['activationState']
): string {
  switch (state) {
    case 'active':
      return '生效中'
    case 'disabled-in-settings':
      return '插件未启用'
    case 'project-scoped-inactive':
      return '非当前项目'
    case 'wsl-unavailable':
      return 'WSL 未就绪'
    case 'unknown':
      return '状态未知'
  }
}
