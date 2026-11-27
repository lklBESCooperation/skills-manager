import type {
  QuickPanelSkillItem,
  QuickPanelSnapshotOutput
} from '../contracts/skill-ui-bridge-contract'
import { bridgeClient, formatBridgeError } from './bridge-client'
import { createSwitchControl, el, replaceContent } from './dom-helpers'
import {
  applyOptimisticMutation,
  filterManagedSkills,
  reconcileQuickPanelSkills,
  rollbackOptimisticMutation,
  summarizeMutationFeedback
} from './filter-model'

type PanelState = {
  loading: boolean
  refreshing: boolean
  loadError: string | null
  actionError: { message: string; retry: (() => void) | null } | null
  snapshot: QuickPanelSnapshotOutput | null
  query: string
  pendingKeys: Set<string>
}

export function mountSkillsPanel(): void {
  const contextBadge = document.getElementById('panel-context-badge')
  const refreshBtn = document.getElementById('panel-refresh-btn') as HTMLButtonElement | null
  const openWorkbenchBtn = document.getElementById('open-workbench') as HTMLButtonElement | null
  const errorSlot = document.getElementById('panel-error-slot')
  const searchSlot = document.getElementById('panel-search-slot')
  const listSlot = document.getElementById('panel-list-slot')
  const footSlot = document.getElementById('panel-foot-slot')

  if (!contextBadge || !refreshBtn || !openWorkbenchBtn || !errorSlot || !searchSlot || !listSlot || !footSlot) {
    return
  }

  const state: PanelState = {
    loading: true,
    refreshing: false,
    loadError: null,
    actionError: null,
    snapshot: null,
    query: '',
    pendingKeys: new Set()
  }

  let searchInputEl: HTMLInputElement | null = null

  const openWorkbench = async (): Promise<void> => {
    try {
      await bridgeClient.openWorkbenchPage()
    } catch (error) {
      state.actionError = {
        message: `无法打开全幅工作台：${formatBridgeError(error)}`,
        retry: () => void openWorkbench()
      }
      render()
    }
  }

  const loadSnapshot = async (silent = false): Promise<void> => {
    if (!silent) {
      state.loading = !state.snapshot
      state.refreshing = Boolean(state.snapshot)
      state.loadError = null
      render()
    }
    try {
      const next = await bridgeClient.getPanelSnapshot()
      state.snapshot = next
      state.loadError = null
    } catch (error) {
      if (!silent || !state.snapshot) {
        state.loadError = formatBridgeError(error)
      }
    } finally {
      state.loading = false
      state.refreshing = false
      render()
    }
  }

  const toggleSkill = async (item: QuickPanelSkillItem): Promise<void> => {
    if (!state.snapshot || state.pendingKeys.has(item.rowKey)) {
      return
    }
    const nextState = item.effective === 'enabled' ? 'disabled' : 'enabled'
    const writeScope = state.snapshot.activeWorkspace.isLocalDirectoryAvailable
      ? 'project'
      : 'user'
    const targetKeys = new Set([item.rowKey])
    const { nextSkills, rollbackSnapshot } = applyOptimisticMutation(
      state.snapshot.managedSkills,
      targetKeys,
      nextState,
      writeScope
    )

    state.snapshot = { ...state.snapshot, managedSkills: nextSkills }
    state.pendingKeys.add(item.rowKey)
    state.actionError = null
    render()

    try {
      const res = await bridgeClient.mutateEnablement({
        kind: nextState === 'enabled' ? 'enable' : 'disable',
        skillIds: [item.id],
        writeScope,
        skillScope: item.scope
      })
      const failedSkillIds = new Set(res.failed.map((f) => f.skillId))
      if (state.snapshot) {
        state.snapshot = {
          ...state.snapshot,
          managedSkills: reconcileQuickPanelSkills(
            state.snapshot.managedSkills,
            res.updatedSkills,
            rollbackSnapshot,
            failedSkillIds
          )
        }
      }
      const feedback = summarizeMutationFeedback([res], `「${item.name}」`)
      if (feedback.kind === 'error') {
        state.actionError = {
          message: feedback.message,
          retry: () => void toggleSkill(item)
        }
      } else if (feedback.kind === 'warn') {
        state.actionError = {
          message: feedback.message,
          retry: null
        }
      }
    } catch (error) {
      if (state.snapshot) {
        state.snapshot = {
          ...state.snapshot,
          managedSkills: rollbackOptimisticMutation(state.snapshot.managedSkills, rollbackSnapshot)
        }
      }
      state.actionError = {
        message: `切换「${item.name}」失败：${formatBridgeError(error)}`,
        retry: () => void toggleSkill(item)
      }
    } finally {
      state.pendingKeys.delete(item.rowKey)
      render()
    }
  }

  const renderSearchBox = (totalCount: number): void => {
    if (totalCount <= 5) {
      searchSlot.hidden = true
      searchInputEl = null
      replaceContent(searchSlot)
      return
    }
    searchSlot.hidden = false
    if (!searchInputEl) {
      searchInputEl = el('input', {
        type: 'search',
        className: 'sm-input',
        placeholder: '快速筛选技能…',
        maxlength: 200,
        value: state.query,
        onInput: (event) => {
          state.query = (event.target as HTMLInputElement).value
          renderListOnly()
        }
      })
      const clearBtn = el(
        'button',
        {
          type: 'button',
          className: 'sm-search-clear',
          title: '清空筛选',
          onClick: () => {
            state.query = ''
            if (searchInputEl) {
              searchInputEl.value = ''
            }
            renderListOnly()
          }
        },
        '×'
      )
      replaceContent(searchSlot, el('div', { className: 'sm-search-wrap' }, searchInputEl, clearBtn))
    }
  }

  const renderListOnly = (): void => {
    if (!state.snapshot) {
      return
    }
    const filtered = filterManagedSkills(state.snapshot.managedSkills, {
      query: state.query,
      scope: 'all',
      status: 'all'
    })

    if (state.snapshot.managedSkills.length === 0) {
      replaceContent(
        listSlot,
        el(
          'div',
          { className: 'sm-empty' },
          el('strong', undefined, '暂无可快捷切换的受管技能'),
          el('span', undefined, '可在工作台纳管或安装技能后进行快捷启停。'),
          el(
            'button',
            { type: 'button', className: 'sm-btn sm-btn-sm', onClick: () => void openWorkbench() },
            '打开全幅工作台'
          )
        )
      )
      return
    }

    if (filtered.length === 0) {
      replaceContent(
        listSlot,
        el(
          'div',
          { className: 'sm-empty' },
          el('span', undefined, `未找到符合“${state.query.trim()}”的技能`),
          el(
            'button',
            {
              type: 'button',
              className: 'sm-btn sm-btn-sm',
              onClick: () => {
                state.query = ''
                if (searchInputEl) {
                  searchInputEl.value = ''
                }
                renderListOnly()
              }
            },
            '清除筛选'
          )
        )
      )
      return
    }

    replaceContent(
      listSlot,
      ...filtered.map((item) => {
        const isPending = state.pendingKeys.has(item.rowKey)
        const tooltip = item.description ? `${item.name}\n${item.description}` : item.name
        return el(
          'div',
          { className: 'sm-panel-row', title: tooltip },
          el(
            'div',
            { className: 'sm-panel-row-left' },
            el('span', { className: 'sm-panel-skill-name' }, item.name),
            el(
              'span',
              {
                className: `sm-badge ${item.scope === 'workspace' ? 'sm-badge-primary' : ''}`,
                title: item.scope === 'workspace' ? 'Workspace 作用域' : 'User 全局作用域'
              },
              item.scope === 'workspace' ? 'W' : 'U'
            ),
            item.origin === 'project'
              ? el('span', { className: 'sm-badge sm-badge-warn' }, '覆盖')
              : null
          ),
          createSwitchControl({
            checked: item.effective === 'enabled',
            pending: isPending,
            label: `切换 ${item.name} 启用状态`,
            onToggle: () => void toggleSkill(item)
          })
        )
      })
    )
  }

  const render = (): void => {
    refreshBtn.disabled = state.loading || state.refreshing
    refreshBtn.textContent = state.refreshing ? '刷新中…' : '刷新'

    if (state.snapshot) {
      const ws = state.snapshot.activeWorkspace
      contextBadge.textContent = ws.isLocalDirectoryAvailable
        ? `工作区: ${ws.workspaceName ?? 'Local'}`
        : '用户全局'
      contextBadge.className = `sm-badge ${ws.isLocalDirectoryAvailable ? 'sm-badge-primary' : ''}`
    } else if (state.loadError) {
      contextBadge.textContent = '连接异常'
      contextBadge.className = 'sm-badge sm-badge-danger'
    } else {
      contextBadge.textContent = '正在加载…'
      contextBadge.className = 'sm-badge'
    }

    if (state.actionError) {
      replaceContent(
        errorSlot,
        el(
          'div',
          { className: 'sm-banner sm-banner-error' },
          el('span', undefined, state.actionError.message),
          el(
            'div',
            { className: 'sm-banner-actions' },
            state.actionError.retry
              ? el(
                  'button',
                  {
                    type: 'button',
                    className: 'sm-btn sm-btn-sm',
                    onClick: () => state.actionError?.retry?.()
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
                  state.actionError = null
                  render()
                }
              },
              '×'
            )
          )
        )
      )
    } else {
      replaceContent(errorSlot)
    }

    if (state.loading) {
      searchSlot.hidden = true
      footSlot.hidden = true
      replaceContent(
        listSlot,
        el('div', { className: 'sm-subtitle' }, '正在加载技能…'),
        el('div', { className: 'sm-skeleton-card' }),
        el('div', { className: 'sm-skeleton-card' }),
        el('div', { className: 'sm-skeleton-card' })
      )
      return
    }

    if (state.loadError && !state.snapshot) {
      searchSlot.hidden = true
      footSlot.hidden = true
      replaceContent(
        listSlot,
        el(
          'div',
          { className: 'sm-banner sm-banner-error' },
          el('div', undefined, el('strong', undefined, '无法加载技能'), el('div', undefined, state.loadError)),
          el(
            'button',
            { type: 'button', className: 'sm-btn sm-btn-sm', onClick: () => void loadSnapshot() },
            '重试'
          )
        )
      )
      return
    }

    if (!state.snapshot) {
      return
    }

    renderSearchBox(state.snapshot.managedSkills.length)
    renderListOnly()

    const footParts: string[] = []
    if (state.snapshot.pluginSkillCount > 0) {
      footParts.push(`含 ${state.snapshot.pluginSkillCount} 个 Plugin 只读技能`)
    }
    if (state.snapshot.adoptableCount > 0) {
      footParts.push(`${state.snapshot.adoptableCount} 个待纳管`)
    }
    if (footParts.length > 0) {
      footSlot.hidden = false
      replaceContent(
        footSlot,
        el(
          'button',
          {
            type: 'button',
            className: 'sm-link-btn',
            onClick: () => void openWorkbench()
          },
          `${footParts.join(' · ')} → 前往工作台查看`
        )
      )
    } else {
      footSlot.hidden = true
      replaceContent(footSlot)
    }
  }

  refreshBtn.addEventListener('click', () => void loadSnapshot())
  openWorkbenchBtn.addEventListener('click', () => void openWorkbench())

  try {
    bridgeClient.onSkillsChanged(() => {
      void loadSnapshot(true)
    })
    bridgeClient.onContextChanged(() => {
      void loadSnapshot(true)
    })
  } catch {
    // Render loop surfaces missing bridge in loadSnapshot
  }

  window.addEventListener('focus', () => {
    if (!state.loading && state.pendingKeys.size === 0) {
      void loadSnapshot(true)
    }
  })

  void loadSnapshot()
}

mountSkillsPanel()
