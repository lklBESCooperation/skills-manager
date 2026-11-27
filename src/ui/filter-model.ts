import type { PluginSkillRecord } from '../contracts/plugin-skill-contract'
import type {
  AdoptableSkillViewItem,
  ManagedSkillViewItem,
  QuickPanelSkillItem
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
  updatedSkills: readonly ManagedSkillViewItem[]
): ManagedSkillViewItem[] {
  if (updatedSkills.length === 0) {
    return [...skills]
  }
  const updatedByKey = new Map(updatedSkills.map((item) => [item.rowKey, item]))
  return skills.map((item) => updatedByKey.get(item.rowKey) ?? item)
}

export function reconcileQuickPanelSkills(
  skills: readonly QuickPanelSkillItem[],
  updatedSkills: readonly ManagedSkillViewItem[]
): QuickPanelSkillItem[] {
  if (updatedSkills.length === 0) {
    return [...skills]
  }
  const updatedByKey = new Map<string, QuickPanelSkillItem>(
    updatedSkills.map(({ agents: _a, agentDetails: _d, ...rest }) => [rest.rowKey, rest])
  )
  return skills.map((item) => updatedByKey.get(item.rowKey) ?? item)
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
