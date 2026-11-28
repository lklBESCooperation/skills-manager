import type { AgentId } from '../contracts/skill-enablement'
import type {
  AdoptableSkillViewItem,
  AgentRegistrySummaryItem,
  ManagedSkillViewItem,
  SkillMutateOutput,
  WorkbenchSnapshotOutput
} from '../contracts/skill-ui-bridge-contract'
import { bridgeClient, formatBridgeError } from './bridge-client'
import { createSwitchControl, el, replaceContent } from './dom-helpers'
import {
  applyOptimisticMutation,
  DEFAULT_WORKBENCH_FILTERS,
  filterAdoptableSkills,
  filterManagedSkills,
  filterPluginSkills,
  formatSourceKindLabel,
  hasActiveFilters,
  reconcileMutatedSkills,
  rollbackOptimisticMutation,
  summarizeMutationFeedback,
  type ScopeFilter,
  type StatusFilter,
  type WorkbenchFilterCriteria
} from './filter-model'
import { createPacksTabController } from './packs-view'
import { createPluginAuditTabController, createPluginSkillCard } from './plugin-audit-view'

type TabId = 'installed' | 'packs' | 'plugin-audit'
type MatrixFilter = 'all' | 'enabled' | 'disabled' | 'unsupported'

export function mountSkillsWorkbench(): void {
  const workspaceBadge = document.getElementById('workspace-context-badge')
  const refreshBtn = document.getElementById('workbench-refresh-btn') as HTMLButtonElement | null
  const alertSlot = document.getElementById('global-alert-slot')
  const installedPanel = document.getElementById('panel-installed')
  const packsPanel = document.getElementById('panel-packs')
  const pluginAuditPanel = document.getElementById('panel-plugin-audit')
  const tabCountInstalled = document.getElementById('tab-count-installed')
  const tabCountPacks = document.getElementById('tab-count-packs')
  const tabCountPlugins = document.getElementById('tab-count-plugins')
  const toastStack = document.getElementById('toast-stack')
  const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tab]'))

  if (
    !workspaceBadge ||
    !refreshBtn ||
    !alertSlot ||
    !installedPanel ||
    !packsPanel ||
    !pluginAuditPanel ||
    !tabCountInstalled ||
    !tabCountPacks ||
    !tabCountPlugins ||
    !toastStack
  ) {
    return
  }

  let activeTab: TabId = 'installed'
  let loading = true
  let refreshing = false
  let loadError: string | null = null
  let actionAlert: { kind: 'error' | 'warn'; message: string; retry?: () => void } | null = null
  let snapshot: WorkbenchSnapshotOutput | null = null
  let filters: WorkbenchFilterCriteria = { ...DEFAULT_WORKBENCH_FILTERS }
  let targetWriteScope: 'user' | 'project' = 'user'
  let targetScopeInitialized = false
  let selectedAgentId: AgentId = 'claude'
  const selectedRowKeys = new Set<string>()
  const selectedAdoptKeys = new Set<string>()
  const pendingRowKeys = new Set<string>()
  const expandedAgents = new Set<string>()
  const expandedDescriptions = new Set<string>()
  const matrixFilterByRow = new Map<string, MatrixFilter>()
  let bulkBusy = false
  let adoptBusy = false
  let searchInputRef: HTMLInputElement | null = null
  let lastPackCount = 0

  const packsController = createPacksTabController()
  const pluginAuditController = createPluginAuditTabController()

  const showToast = (message: string): void => {
    const toast = el('div', { className: 'sm-toast' }, message)
    toastStack.appendChild(toast)
    setTimeout(() => {
      toast.remove()
    }, 3200)
  }

  const getAgentMap = (): Map<string, AgentRegistrySummaryItem> =>
    new Map((snapshot?.agentRegistry ?? []).map((a) => [a.id, a]))

  const switchTab = (next: TabId): void => {
    activeTab = next
    for (const btn of tabButtons) {
      btn.setAttribute('aria-selected', String(btn.dataset.tab === next))
    }
    installedPanel.hidden = next !== 'installed'
    packsPanel.hidden = next !== 'packs'
    pluginAuditPanel.hidden = next !== 'plugin-audit'
    renderActiveTab()
  }

  const loadSnapshot = async (silent = false): Promise<void> => {
    if (!silent) {
      loading = !snapshot
      refreshing = Boolean(snapshot)
      loadError = null
      renderAll()
    }
    try {
      const next = await bridgeClient.getWorkbenchSnapshot()
      snapshot = next
      loadError = null
      if (!targetScopeInitialized) {
        targetWriteScope = next.activeWorkspace.isLocalDirectoryAvailable ? 'project' : 'user'
        targetScopeInitialized = true
      } else if (!next.activeWorkspace.isLocalDirectoryAvailable) {
        targetWriteScope = 'user'
        if (filters.scope === 'workspace') {
          filters.scope = 'all'
        }
      }
    } catch (error) {
      if (!silent || !snapshot) {
        loadError = formatBridgeError(error)
      }
    } finally {
      loading = false
      refreshing = false
      renderAll()
    }
  }

  const rescanPlugins = async (): Promise<void> => {
    if (!snapshot) {
      return
    }
    try {
      const res = await bridgeClient.rescanPlugins()
      snapshot = {
        ...snapshot,
        pluginSkills: res.pluginSkills,
        pluginScanError: res.pluginScanError
      }
      renderAll()
    } catch (error) {
      if (snapshot) {
        snapshot = {
          ...snapshot,
          pluginScanError: formatBridgeError(error)
        }
      }
      renderAll()
    }
  }

  const runMutation = async (input: {
    items: readonly ManagedSkillViewItem[]
    kind: 'enable' | 'disable' | 'inherit'
    agents?: Partial<Record<AgentId, boolean>>
    successText: string
  }): Promise<void> => {
    if (!snapshot || input.items.length === 0) {
      return
    }
    const rowKeySet = new Set(input.items.map((item) => item.rowKey))
    const isSingle = input.items.length === 1
    if (isSingle && pendingRowKeys.has(input.items[0].rowKey)) {
      return
    }

    const optimisticTarget =
      input.kind === 'enable' ? 'enabled' : input.kind === 'disable' ? 'disabled' : null

    const { nextSkills, rollbackSnapshot } = optimisticTarget
      ? applyOptimisticMutation(
          snapshot.managedSkills,
          rowKeySet,
          optimisticTarget,
          targetWriteScope
        )
      : { nextSkills: snapshot.managedSkills, rollbackSnapshot: new Map() }

    if (optimisticTarget && !input.agents) {
      snapshot = { ...snapshot, managedSkills: nextSkills }
    }
    for (const k of rowKeySet) {
      pendingRowKeys.add(k)
    }
    if (!isSingle) {
      bulkBusy = true
    }
    actionAlert = null
    renderAll()

    // Group by skill.scope so user & workspace vault items both resolve accurately.
    const byScope = new Map<'user' | 'workspace', ManagedSkillViewItem[]>()
    for (const item of input.items) {
      const arr = byScope.get(item.scope) ?? []
      arr.push(item)
      byScope.set(item.scope, arr)
    }

    try {
      let updatedAll: ManagedSkillViewItem[] = []
      const results: SkillMutateOutput[] = []

      for (const [skillScope, items] of byScope.entries()) {
        const res = await bridgeClient.mutateEnablement({
          kind: input.kind,
          skillIds: items.map((i) => i.id),
          writeScope: skillScope === 'workspace' ? 'project' : targetWriteScope,
          skillScope,
          ...(input.agents ? { agents: input.agents } : {})
        })
        results.push(res)
        updatedAll = [...updatedAll, ...res.updatedSkills]
      }

      const failedSkillIds = new Set(results.flatMap((r) => r.failed.map((f) => f.skillId)))
      if (snapshot) {
        snapshot = {
          ...snapshot,
          managedSkills: reconcileMutatedSkills(
            snapshot.managedSkills,
            updatedAll,
            rollbackSnapshot,
            failedSkillIds
          )
        }
      }

      const label =
        input.items.length === 1 ? `「${input.items[0].name}」` : `${input.items.length} 个技能`
      const feedback = summarizeMutationFeedback(results, label)
      if (feedback.kind === 'error') {
        actionAlert = {
          kind: 'error',
          message: feedback.message,
          retry: () => void runMutation(input)
        }
      } else if (feedback.kind === 'warn') {
        actionAlert = { kind: 'warn', message: feedback.message }
      } else {
        showToast(input.successText)
      }
    } catch (error) {
      if (snapshot && rollbackSnapshot.size > 0) {
        snapshot = {
          ...snapshot,
          managedSkills: rollbackOptimisticMutation(snapshot.managedSkills, rollbackSnapshot)
        }
      }
      const label =
        input.items.length === 1 ? `「${input.items[0].name}」` : `${input.items.length} 个技能`
      actionAlert = {
        kind: 'error',
        message: `切换 ${label} 状态失败：${formatBridgeError(error)}，已回滚至原状态。`,
        retry: () => void runMutation(input)
      }
    } finally {
      for (const k of rowKeySet) {
        pendingRowKeys.delete(k)
      }
      bulkBusy = false
      renderAll()
    }
  }

  const runBatchAdopt = async (items: readonly AdoptableSkillViewItem[]): Promise<void> => {
    const adoptable = items.filter((i) => i.disposition === 'adoptable')
    if (adoptable.length === 0 || adoptBusy) {
      return
    }
    adoptBusy = true
    actionAlert = null
    renderAll()

    const byScope = new Map<'user' | 'workspace', string[]>()
    for (const item of adoptable) {
      const list = byScope.get(item.scope) ?? []
      list.push(item.id)
      byScope.set(item.scope, list)
    }

    try {
      const adoptedIds: string[] = []
      for (const [scope, skillIds] of byScope.entries()) {
        const res = await bridgeClient.adoptSkills({ scope, skillIds })
        adoptedIds.push(...res.adoptedIds)
      }
      selectedAdoptKeys.clear()
      showToast(`已成功纳管 ${adoptedIds.length} 个技能到 Vault`)
      await loadSnapshot(true)
    } catch (error) {
      actionAlert = {
        kind: 'error',
        message: `批量 Adopt 纳管失败：${formatBridgeError(error)}`,
        retry: () => void runBatchAdopt(items)
      }
    } finally {
      adoptBusy = false
      renderAll()
    }
  }

  const renderManagedSkillCard = (
    item: ManagedSkillViewItem,
    agentMap: ReadonlyMap<string, AgentRegistrySummaryItem>
  ): HTMLElement => {
    const isPending = pendingRowKeys.has(item.rowKey)
    const isChecked = selectedRowKeys.has(item.rowKey)
    const isMatrixOpen = expandedAgents.has(item.rowKey)
    const isDescExpanded = expandedDescriptions.has(item.rowKey)
    const matrixFilter = matrixFilterByRow.get(item.rowKey) ?? 'all'

    const enabledAgents = Object.entries(item.agents ?? {})
      .filter(([, enabled]) => Boolean(enabled))
      .map(([agentId]) => agentMap.get(agentId)?.displayName ?? agentId)

    const previewAgents = enabledAgents.slice(0, 4)
    const extraAgentsCount = Math.max(0, enabledAgents.length - previewAgents.length)

    const showInheritBtn =
      snapshot?.activeWorkspace.isLocalDirectoryAvailable &&
      targetWriteScope === 'project' &&
      item.origin === 'project'

    const card = el(
      'article',
      { className: 'sm-skill-card', 'data-managed-skill': item.rowKey },
      el(
        'div',
        { className: 'sm-skill-top' },
        el(
          'div',
          { className: 'sm-skill-left' },
          el('input', {
            type: 'checkbox',
            checked: isChecked,
            'aria-label': `选择 ${item.name}`,
            onChange: (event) => {
              if ((event.target as HTMLInputElement).checked) {
                selectedRowKeys.add(item.rowKey)
              } else {
                selectedRowKeys.delete(item.rowKey)
              }
              renderInstalledTab()
            }
          }),
          el(
            'div',
            { className: 'sm-skill-main' },
            el(
              'div',
              { className: 'sm-skill-name-line' },
              el('span', { className: 'sm-skill-name' }, item.name || item.id),
              item.name && item.name !== item.id
                ? el('span', { className: 'sm-skill-id' }, item.id)
                : null,
              el('span', { className: 'sm-badge' }, formatSourceKindLabel(item.sourceKind)),
              el(
                'span',
                {
                  className: `sm-badge ${item.scope === 'workspace' ? 'sm-badge-primary' : ''}`
                },
                item.scope === 'workspace' ? 'Workspace（工作区）' : 'User（全局）'
              ),
              snapshot?.activeWorkspace.isLocalDirectoryAvailable
                ? el(
                    'span',
                    {
                      className: `sm-badge ${item.origin === 'project' ? 'sm-badge-warn' : ''}`
                    },
                    item.origin === 'project' ? '工作区覆盖' : '继承全局'
                  )
                : null,
              item.copyMode ? el('span', { className: 'sm-badge sm-badge-warn' }, 'Copy 模式') : null,
              item.copyModeState === 'managed-copy-drifted'
                ? el('span', { className: 'sm-badge sm-badge-danger' }, '副本已漂移')
                : item.copyModeState === 'foreign-conflict'
                  ? el('span', { className: 'sm-badge sm-badge-danger' }, '存在目录冲突')
                  : null
            ),
            el(
              'p',
              {
                className: `sm-skill-desc${isDescExpanded ? ' is-expanded' : ''}`,
                title: item.description ?? '',
                onClick: () => {
                  if (item.description && item.description.length > 80) {
                    if (isDescExpanded) {
                      expandedDescriptions.delete(item.rowKey)
                    } else {
                      expandedDescriptions.add(item.rowKey)
                    }
                    renderInstalledTab()
                  }
                }
              },
              item.description && item.description.trim() ? item.description : '暂无描述'
            )
          )
        ),
        el(
          'div',
          { className: 'sm-skill-controls' },
          showInheritBtn
            ? el(
                'button',
                {
                  type: 'button',
                  className: 'sm-btn sm-btn-sm',
                  disabled: isPending,
                  onClick: () =>
                    void runMutation({
                      items: [item],
                      kind: 'inherit',
                      successText: `已恢复全局继承「${item.name}」`
                    })
                },
                '恢复继承'
              )
            : null,
          el(
            'span',
            {
              className: `sm-badge ${item.effective === 'enabled' ? 'sm-badge-success' : ''}`
            },
            item.effective === 'enabled' ? '已启用' : '已停用'
          ),
          createSwitchControl({
            checked: item.effective === 'enabled',
            pending: isPending,
            label: `切换 ${item.name} 启用状态`,
            onToggle: () => {
              const nextKind = item.effective === 'enabled' ? 'disable' : 'enable'
              void runMutation({
                items: [item],
                kind: nextKind,
                successText: `${nextKind === 'enable' ? '已启用' : '已停用'}「${item.name}」`
              })
            }
          })
        )
      ),
      el(
        'div',
        { className: 'sm-skill-meta' },
        el(
          'div',
          { className: 'sm-agent-summary' },
          el(
            'span',
            { className: 'sm-subtitle' },
            `已启用 ${item.enabledAgentCount} / ${item.supportedAgentCount} 个支持 Agent`
          ),
          ...previewAgents.map((name) => el('span', { className: 'sm-badge' }, name)),
          extraAgentsCount > 0
            ? el('span', { className: 'sm-badge' }, `+${extraAgentsCount}`)
            : null
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'sm-btn sm-btn-ghost sm-btn-sm',
            onClick: () => {
              if (isMatrixOpen) {
                expandedAgents.delete(item.rowKey)
              } else {
                expandedAgents.add(item.rowKey)
              }
              renderInstalledTab()
            }
          },
          isMatrixOpen ? '收起 Agent 状态 ▲' : '查看全部 Agent 状态 ▼'
        )
      )
    )

    if (isMatrixOpen && snapshot) {
      const filteredAgents = snapshot.agentRegistry.filter((agent) => {
        const detail = item.agentDetails?.[agent.id]
        const isUnsupported = agent.capability === 'unsupported' || detail?.origin === 'unsupported'
        const isEnabled = Boolean(item.agents?.[agent.id])
        if (matrixFilter === 'enabled') return !isUnsupported && isEnabled
        if (matrixFilter === 'disabled') return !isUnsupported && !isEnabled
        if (matrixFilter === 'unsupported') return isUnsupported
        return true
      })

      const originLabel = (agent: AgentRegistrySummaryItem): string => {
        const detail = item.agentDetails?.[agent.id]
        if (!detail || detail.origin === 'unsupported' || agent.capability === 'unsupported') {
          return '暂不支持'
        }
        const readMode = agent.delegatesTo
          ? `委托 ${agentMap.get(agent.delegatesTo)?.displayName ?? agent.delegatesTo}`
          : agent.readsCanonical
            ? '读取 .agents/skills'
            : '独立目录'
        if (detail.origin === 'borrowed-lock') {
          const fromName = detail.borrowedFrom
            ? agentMap.get(detail.borrowedFrom)?.displayName ?? detail.borrowedFrom
            : '其他 Agent'
          return `借读自 ${fromName}（锁定）`
        }
        if (detail.origin === 'agent-override') return `${readMode} · Agent 独立覆盖`
        if (detail.origin === 'project') return `${readMode} · 工作区覆盖`
        return `${readMode} · 全局默认`
      }

      card.appendChild(
        el(
          'div',
          { className: 'sm-matrix' },
          el(
            'div',
            { className: 'sm-matrix-toolbar' },
            el('strong', { className: 'sm-field-label' }, `全部 ${snapshot.agentRegistry.length} 个 Agent 生效明细`),
            el(
              'div',
              { className: 'sm-tabs' },
              ...(
                [
                  ['all', '全部'],
                  ['enabled', '已启用'],
                  ['disabled', '已停用'],
                  ['unsupported', '不支持']
                ] as const
              ).map(([key, label]) =>
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'sm-tab',
                    'aria-selected': String(matrixFilter === key),
                    onClick: () => {
                      matrixFilterByRow.set(item.rowKey, key)
                      renderInstalledTab()
                    }
                  },
                  label
                )
              )
            )
          ),
          el(
            'div',
            { className: 'sm-matrix-grid' },
            ...filteredAgents.map((agent) => {
              const detail = item.agentDetails?.[agent.id]
              const unsupported =
                agent.capability === 'unsupported' || detail?.origin === 'unsupported'
              const on = !unsupported && Boolean(item.agents?.[agent.id])
              return el(
                'div',
                { className: 'sm-agent-cell' },
                el(
                  'div',
                  { className: 'sm-agent-cell-left' },
                  el('span', { className: 'sm-agent-cell-name' }, agent.displayName),
                  el('span', { className: 'sm-agent-cell-sub' }, originLabel(agent))
                ),
                el(
                  'span',
                  {
                    className: `sm-badge ${unsupported ? '' : on ? 'sm-badge-success' : ''}`
                  },
                  unsupported ? '不支持' : on ? '已启用' : '已停用'
                )
              )
            })
          )
        )
      )
    }

    return card
  }

  const renderInstalledTab = (): void => {
    if (loading) {
      replaceContent(
        installedPanel,
        el('div', { className: 'sm-subtitle' }, '正在加载本地技能数据…'),
        el('div', { className: 'sm-skeleton-card' }),
        el('div', { className: 'sm-skeleton-card' }),
        el('div', { className: 'sm-skeleton-card' })
      )
      return
    }

    if (loadError && !snapshot) {
      replaceContent(
        installedPanel,
        el(
          'div',
          { className: 'sm-banner sm-banner-error' },
          el(
            'div',
            undefined,
            el('strong', undefined, '无法加载技能列表'),
            el('div', undefined, loadError)
          ),
          el(
            'button',
            { type: 'button', className: 'sm-btn', onClick: () => void loadSnapshot() },
            '重试'
          )
        )
      )
      return
    }

    if (!snapshot) {
      return
    }

    const agentMap = getAgentMap()
    const filteredManaged = filterManagedSkills(snapshot.managedSkills, filters)
    const filteredAdoptable = filterAdoptableSkills(snapshot.adoptableSkills, filters)
    const filteredPlugins = filterPluginSkills(snapshot.pluginSkills, filters.query)

    // Keep search input element identity across keystrokes so focus is never lost.
    if (!searchInputRef) {
      searchInputRef = el('input', {
        type: 'search',
        className: 'sm-input',
        placeholder: '搜索技能名称、描述、ID、标签或插件…',
        maxlength: 200,
        value: filters.query,
        onInput: (event) => {
          filters.query = (event.target as HTMLInputElement).value
          renderInstalledSectionsOnly()
        }
      })
    } else if (searchInputRef.value !== filters.query) {
      searchInputRef.value = filters.query
    }

    const clearFilters = (): void => {
      filters = { ...DEFAULT_WORKBENCH_FILTERS }
      if (searchInputRef) {
        searchInputRef.value = ''
      }
      renderInstalledTab()
    }

    const toolbar = el(
      'div',
      { className: 'sm-toolbar' },
      el(
        'div',
        { className: 'sm-search-wrap' },
        searchInputRef,
        filters.query
          ? el(
              'button',
              {
                type: 'button',
                className: 'sm-search-clear',
                title: '清除搜索',
                onClick: () => {
                  filters.query = ''
                  if (searchInputRef) {
                    searchInputRef.value = ''
                  }
                  renderInstalledTab()
                }
              },
              '×'
            )
          : null
      ),
      el(
        'select',
        {
          className: 'sm-select',
          'aria-label': '作用域筛选',
          onChange: (e) => {
            filters.scope = (e.target as HTMLSelectElement).value as ScopeFilter
            renderInstalledTab()
          }
        },
        el('option', { value: 'all', selected: filters.scope === 'all' }, '全部作用域'),
        el('option', { value: 'user', selected: filters.scope === 'user' }, 'User（全局）'),
        el(
          'option',
          {
            value: 'workspace',
            selected: filters.scope === 'workspace',
            disabled: !snapshot.activeWorkspace.isLocalDirectoryAvailable
          },
          snapshot.activeWorkspace.isLocalDirectoryAvailable ? 'Workspace（工作区）' : 'Workspace（无工作区）'
        )
      ),
      el(
        'select',
        {
          className: 'sm-select',
          'aria-label': '状态筛选',
          onChange: (e) => {
            filters.status = (e.target as HTMLSelectElement).value as StatusFilter
            renderInstalledTab()
          }
        },
        el('option', { value: 'all', selected: filters.status === 'all' }, '全部状态'),
        el('option', { value: 'enabled', selected: filters.status === 'enabled' }, '已启用'),
        el('option', { value: 'disabled', selected: filters.status === 'disabled' }, '已停用')
      ),
      el(
        'select',
        {
          className: 'sm-select',
          'aria-label': '操作目标作用域',
          disabled: !snapshot.activeWorkspace.isLocalDirectoryAvailable,
          onChange: (e) => {
            targetWriteScope = (e.target as HTMLSelectElement).value as 'user' | 'project'
            renderInstalledTab()
          }
        },
        el(
          'option',
          { value: 'project', selected: targetWriteScope === 'project', disabled: !snapshot.activeWorkspace.isLocalDirectoryAvailable },
          '操作目标: 当前工作区'
        ),
        el('option', { value: 'user', selected: targetWriteScope === 'user' }, '操作目标: 用户全局默认')
      ),
      hasActiveFilters(filters)
        ? el(
            'button',
            { type: 'button', className: 'sm-btn sm-btn-sm', onClick: clearFilters },
            '重置筛选'
          )
        : null
    )

    const sectionsContainer = el('div', { className: 'sm-section', id: 'installed-sections-body' })
    replaceContent(installedPanel, toolbar, sectionsContainer)
    renderInstalledSectionsInto(
      sectionsContainer,
      snapshot,
      agentMap,
      filteredManaged,
      filteredAdoptable,
      filteredPlugins,
      clearFilters
    )
  }

  const renderInstalledSectionsOnly = (): void => {
    const sectionsContainer = document.getElementById('installed-sections-body')
    if (!sectionsContainer || !snapshot) {
      renderInstalledTab()
      return
    }
    const agentMap = getAgentMap()
    const filteredManaged = filterManagedSkills(snapshot.managedSkills, filters)
    const filteredAdoptable = filterAdoptableSkills(snapshot.adoptableSkills, filters)
    const filteredPlugins = filterPluginSkills(snapshot.pluginSkills, filters.query)
    renderInstalledSectionsInto(
      sectionsContainer,
      snapshot,
      agentMap,
      filteredManaged,
      filteredAdoptable,
      filteredPlugins,
      () => {
        filters = { ...DEFAULT_WORKBENCH_FILTERS }
        if (searchInputRef) {
          searchInputRef.value = ''
        }
        renderInstalledTab()
      }
    )
  }

  const renderInstalledSectionsInto = (
    container: HTMLElement,
    snap: WorkbenchSnapshotOutput,
    agentMap: ReadonlyMap<string, AgentRegistrySummaryItem>,
    filteredManaged: readonly ManagedSkillViewItem[],
    filteredAdoptable: readonly AdoptableSkillViewItem[],
    filteredPlugins: readonly WorkbenchSnapshotOutput['pluginSkills'][number][],
    clearFilters: () => void
  ): void => {
    const nodes: HTMLElement[] = []

    // Managed Skills section
    const managedSection = el('section', { className: 'sm-section' })
    managedSection.appendChild(
      el(
        'div',
        { className: 'sm-section-header' },
        el(
          'h2',
          { className: 'sm-section-title' },
          `受管技能 (${filteredManaged.length} / ${snap.managedSkills.length})`
        )
      )
    )

    if (filteredManaged.length > 0) {
      const allFilteredSelected =
        filteredManaged.length > 0 &&
        filteredManaged.every((item) => selectedRowKeys.has(item.rowKey))
      const selectedItems = snap.managedSkills.filter((item) => selectedRowKeys.has(item.rowKey))
      const supportedAgents = snap.agentRegistry.filter((a) => a.capability !== 'unsupported')
      if (!supportedAgents.some((a) => a.id === selectedAgentId) && supportedAgents[0]) {
        selectedAgentId = supportedAgents[0].id
      }

      managedSection.appendChild(
        el(
          'div',
          { className: 'sm-bulk-bar' },
          el(
            'div',
            { className: 'sm-bulk-left' },
            el(
              'label',
              { className: 'sm-checkbox-label' },
              el('input', {
                type: 'checkbox',
                checked: allFilteredSelected,
                onChange: (e) => {
                  if ((e.target as HTMLInputElement).checked) {
                    for (const item of filteredManaged) selectedRowKeys.add(item.rowKey)
                  } else {
                    for (const item of filteredManaged) selectedRowKeys.delete(item.rowKey)
                  }
                  renderInstalledTab()
                }
              }),
              el('span', undefined, `全选当前 (${selectedItems.length} 已选)`)
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'sm-btn sm-btn-sm sm-btn-primary',
                disabled: selectedItems.length === 0 || bulkBusy,
                onClick: () =>
                  void runMutation({
                    items: selectedItems,
                    kind: 'enable',
                    successText: `已批量启用 ${selectedItems.length} 个技能`
                  })
              },
              '批量启用'
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'sm-btn sm-btn-sm',
                disabled: selectedItems.length === 0 || bulkBusy,
                onClick: () =>
                  void runMutation({
                    items: selectedItems,
                    kind: 'disable',
                    successText: `已批量停用 ${selectedItems.length} 个技能`
                  })
              },
              '批量停用'
            ),
            snap.activeWorkspace.isLocalDirectoryAvailable
              ? el(
                  'button',
                  {
                    type: 'button',
                    className: 'sm-btn sm-btn-sm',
                    disabled: selectedItems.length === 0 || bulkBusy,
                    onClick: () =>
                      void runMutation({
                        items: selectedItems,
                        kind: 'inherit',
                        successText: `已批量恢复 ${selectedItems.length} 个技能全局继承`
                      })
                  },
                  '批量恢复继承'
                )
              : null
          ),
          el(
            'div',
            { className: 'sm-bulk-right' },
            el(
              'select',
              {
                className: 'sm-select',
                'aria-label': '目标 Agent',
                onChange: (e) => {
                  selectedAgentId = (e.target as HTMLSelectElement).value as AgentId
                }
              },
              ...supportedAgents.map((agent) =>
                el(
                  'option',
                  { value: agent.id, selected: agent.id === selectedAgentId },
                  agent.displayName
                )
              )
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'sm-btn sm-btn-sm',
                disabled: selectedItems.length === 0 || bulkBusy,
                onClick: () =>
                  void runMutation({
                    items: selectedItems,
                    kind: 'enable',
                    agents: { [selectedAgentId]: true },
                    successText: `已为 ${selectedItems.length} 个技能启用 ${agentMap.get(selectedAgentId)?.displayName ?? selectedAgentId}`
                  })
              },
              '对所选启用该 Agent'
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'sm-btn sm-btn-sm',
                disabled: selectedItems.length === 0 || bulkBusy,
                onClick: () =>
                  void runMutation({
                    items: selectedItems,
                    kind: 'disable',
                    agents: { [selectedAgentId]: false },
                    successText: `已为 ${selectedItems.length} 个技能停用 ${agentMap.get(selectedAgentId)?.displayName ?? selectedAgentId}`
                  })
              },
              '对所选停用该 Agent'
            )
          )
        )
      )
    }

    if (snap.managedSkills.length === 0) {
      managedSection.appendChild(
        el(
          'div',
          { className: 'sm-empty' },
          el('strong', undefined, '暂无已安装的受管技能'),
          el(
            'span',
            undefined,
            '本地 Vault 与共享技能目录中尚未发现可管理的技能；若下方 Plugin Skills 存在内置技能，可只读查看。'
          ),
          el(
            'button',
            { type: 'button', className: 'sm-btn', onClick: () => void loadSnapshot() },
            '刷新扫描'
          )
        )
      )
    } else if (filteredManaged.length === 0) {
      const onlyPluginsMatched = filteredPlugins.length > 0
      managedSection.appendChild(
        el(
          'div',
          { className: 'sm-empty' },
          el(
            'strong',
            undefined,
            onlyPluginsMatched
              ? '受管技能无匹配，请查看下方 Plugin 只读区匹配项'
              : `未找到符合“${filters.query.trim() || '当前筛选条件'}”的技能`
          ),
          el(
            'button',
            { type: 'button', className: 'sm-btn', onClick: clearFilters },
            '清除搜索与筛选'
          )
        )
      )
    } else {
      managedSection.appendChild(
        el(
          'div',
          { className: 'sm-list' },
          ...filteredManaged.map((item) => renderManagedSkillCard(item, agentMap))
        )
      )
    }
    nodes.push(managedSection)

    // Adoptable skills section (if any detected in agent directories)
    if (filteredAdoptable.length > 0) {
      const adoptableOnly = filteredAdoptable.filter((i) => i.disposition === 'adoptable')
      const selectedAdoptItems = adoptableOnly.filter((i) => selectedAdoptKeys.has(i.rowKey))
      const adoptSection = el('section', { className: 'sm-section' })
      adoptSection.appendChild(
        el(
          'div',
          { className: 'sm-section-header' },
          el(
            'h2',
            { className: 'sm-section-title' },
            `待纳管技能 (Adoptable · ${filteredAdoptable.length})`
          ),
          el(
            'div',
            { className: 'sm-header-actions' },
            adoptableOnly.length > 0
              ? el(
                  'button',
                  {
                    type: 'button',
                    className: 'sm-btn sm-btn-primary sm-btn-sm',
                    disabled: adoptBusy,
                    onClick: () =>
                      void runBatchAdopt(
                        selectedAdoptItems.length > 0 ? selectedAdoptItems : adoptableOnly
                      )
                  },
                  selectedAdoptItems.length > 0
                    ? `Adopt 所选 (${selectedAdoptItems.length})`
                    : `一键全部 Adopt (${adoptableOnly.length})`
                )
              : null
          )
        )
      )
      adoptSection.appendChild(
        el(
          'div',
          { className: 'sm-list' },
          ...filteredAdoptable.map((item) => {
            const isConflict = item.disposition === 'conflict'
            return el(
              'article',
              { className: 'sm-skill-card' },
              el(
                'div',
                { className: 'sm-skill-top' },
                el(
                  'div',
                  { className: 'sm-skill-left' },
                  !isConflict
                    ? el('input', {
                        type: 'checkbox',
                        checked: selectedAdoptKeys.has(item.rowKey),
                        onChange: (e) => {
                          if ((e.target as HTMLInputElement).checked) {
                            selectedAdoptKeys.add(item.rowKey)
                          } else {
                            selectedAdoptKeys.delete(item.rowKey)
                          }
                          renderInstalledSectionsOnly()
                        }
                      })
                    : null,
                  el(
                    'div',
                    { className: 'sm-skill-main' },
                    el(
                      'div',
                      { className: 'sm-skill-name-line' },
                      el('span', { className: 'sm-skill-name' }, item.name),
                      el('span', { className: 'sm-skill-id' }, item.id),
                      el(
                        'span',
                        { className: `sm-badge ${isConflict ? 'sm-badge-danger' : 'sm-badge-primary'}` },
                        isConflict ? `内容冲突 (${item.conflictCount} 份)` : '待纳管'
                      ),
                      el('span', { className: 'sm-badge' }, item.scope === 'workspace' ? 'Workspace' : 'User')
                    ),
                    el(
                      'p',
                      { className: 'sm-skill-desc' },
                      item.description || `来源路径：${item.originPath}`
                    )
                  )
                ),
                !isConflict
                  ? el(
                      'button',
                      {
                        type: 'button',
                        className: 'sm-btn sm-btn-sm',
                        disabled: adoptBusy,
                        onClick: () => void runBatchAdopt([item])
                      },
                      'Adopt 纳管'
                    )
                  : null
              )
            )
          })
        )
      )
      nodes.push(adoptSection)
    }

    // Plugin Skills Read-Only Section (PRD Section E — zero write controls)
    const pluginSection = el('section', { className: 'sm-section', 'data-section': 'plugin-readonly' })
    pluginSection.appendChild(
      el(
        'div',
        { className: 'sm-section-header' },
        el(
          'h2',
          { className: 'sm-section-title' },
          `Plugin Skills 只读 (${filteredPlugins.length} / ${snap.pluginSkills.length})`
        )
      )
    )
    pluginSection.appendChild(
      el(
        'div',
        { className: 'sm-banner sm-banner-readonly' },
        el(
          'span',
          undefined,
          'Plugin Skills 只读区：以下技能由宿主或 Agent 插件自带并托管。为避免破坏插件完整性与更新校验，此处不支持启用/停用开关、编辑、删除或 Adopt 纳管。'
        )
      )
    )

    if (snap.pluginScanError) {
      pluginSection.appendChild(
        el(
          'div',
          { className: 'sm-banner sm-banner-error' },
          el('span', undefined, `Plugin 只读技能扫描失败：${snap.pluginScanError}`),
          el(
            'button',
            { type: 'button', className: 'sm-btn sm-btn-sm', onClick: () => void rescanPlugins() },
            '重试加载插件技能'
          )
        )
      )
    } else if (snap.pluginSkills.length === 0) {
      pluginSection.appendChild(
        el('div', { className: 'sm-empty' }, el('span', undefined, '未检测到宿主或 Agent 插件内置技能'))
      )
    } else if (filteredPlugins.length === 0) {
      pluginSection.appendChild(
        el(
          'div',
          { className: 'sm-empty' },
          el('span', undefined, `Plugin 只读区无符合“${filters.query.trim()}”的匹配项`)
        )
      )
    } else {
      pluginSection.appendChild(
        el(
          'div',
          { className: 'sm-list' },
          ...filteredPlugins.map((skill) => createPluginSkillCard(skill, agentMap, showToast))
        )
      )
    }
    nodes.push(pluginSection)

    replaceContent(container, ...nodes)
  }

  const renderActiveTab = (): void => {
    if (activeTab === 'installed') {
      renderInstalledTab()
    } else if (activeTab === 'packs') {
      packsController.render(packsPanel, {
        activeWorkspace: snapshot?.activeWorkspace ?? {
          workspaceId: null,
          workspaceName: null,
          isLocalDirectoryAvailable: false
        },
        managedSkills: snapshot?.managedSkills ?? [],
        onAfterMutate: () => loadSnapshot(true),
        onToast: showToast,
        onPackCountChange: (count) => {
          lastPackCount = count
          tabCountPacks.textContent = String(count)
        }
      })
    } else {
      pluginAuditController.render(pluginAuditPanel, {
        activeWorkspace: snapshot?.activeWorkspace ?? {
          workspaceId: null,
          workspaceName: null,
          isLocalDirectoryAvailable: false
        },
        pluginSkills: snapshot?.pluginSkills ?? [],
        pluginScanError: snapshot?.pluginScanError ?? null,
        agentMap: getAgentMap(),
        onRescanPlugins: rescanPlugins,
        onToast: showToast
      })
    }
  }

  const renderAll = (): void => {
    refreshBtn.disabled = loading || refreshing
    refreshBtn.textContent = refreshing ? '刷新中…' : '刷新'

    if (snapshot) {
      const ws = snapshot.activeWorkspace
      workspaceBadge.textContent = ws.isLocalDirectoryAvailable
        ? `当前工作区: ${ws.workspaceName ?? 'Local'}`
        : '未打开工作区（仅全局模式）'
      workspaceBadge.className = `sm-badge ${ws.isLocalDirectoryAvailable ? 'sm-badge-primary' : ''}`
      tabCountInstalled.textContent = String(snapshot.managedSkills.length)
      tabCountPlugins.textContent = String(snapshot.pluginSkills.length)
    } else if (loadError) {
      workspaceBadge.textContent = '加载失败'
      workspaceBadge.className = 'sm-badge sm-badge-danger'
    } else {
      workspaceBadge.textContent = '正在检测工作区…'
      workspaceBadge.className = 'sm-badge'
    }
    tabCountPacks.textContent = String(lastPackCount)

    if (actionAlert) {
      replaceContent(
        alertSlot,
        el(
          'div',
          {
            className: `sm-banner ${actionAlert.kind === 'error' ? 'sm-banner-error' : 'sm-banner-warn'}`
          },
          el('span', undefined, actionAlert.message),
          el(
            'div',
            { className: 'sm-banner-actions' },
            actionAlert.retry
              ? el(
                  'button',
                  {
                    type: 'button',
                    className: 'sm-btn sm-btn-sm',
                    onClick: () => actionAlert?.retry?.()
                  },
                  '重试'
                )
              : null,
            el(
              'button',
              {
                type: 'button',
                className: 'sm-btn sm-btn-ghost sm-btn-sm',
                onClick: () => {
                  actionAlert = null
                  renderAll()
                }
              },
              '关闭'
            )
          )
        )
      )
    } else {
      replaceContent(alertSlot)
    }

    renderActiveTab()
  }

  for (let idx = 0; idx < tabButtons.length; idx += 1) {
    const btn = tabButtons[idx]
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab as TabId | undefined
      if (tab) {
        switchTab(tab)
      }
    })
    btn.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        const delta = event.key === 'ArrowRight' ? 1 : -1
        const nextBtn = tabButtons[(idx + delta + tabButtons.length) % tabButtons.length]
        const nextTab = nextBtn?.dataset.tab as TabId | undefined
        if (nextBtn && nextTab) {
          nextBtn.focus()
          switchTab(nextTab)
        }
      }
    })
  }

  refreshBtn.addEventListener('click', () => {
    void loadSnapshot()
    if (activeTab === 'packs') {
      void packsController.load()
    }
  })

  try {
    bridgeClient.onSkillsChanged(() => {
      void loadSnapshot(true)
    })
    bridgeClient.onContextChanged(() => {
      targetScopeInitialized = false
      void loadSnapshot(true)
      if (activeTab === 'packs') {
        void packsController.load()
      }
    })
  } catch {
    // Error handled in loadSnapshot
  }

  window.addEventListener('focus', () => {
    if (!loading && pendingRowKeys.size === 0) {
      void loadSnapshot(true)
    }
  })

  void loadSnapshot()
}

mountSkillsWorkbench()
