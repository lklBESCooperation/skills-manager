import {
  isDynamicSkillPack,
  type DynamicPackConditionV2,
  type SkillPackOperationMode,
  type SkillPackScope,
  type SkillPackV2
} from '../contracts/skill-pack-contract'
import type {
  ManagedSkillViewItem,
  PackListOutput,
  PackPreviewOutput,
  WorkspaceContextSummary
} from '../contracts/skill-ui-bridge-contract'
import { bridgeClient, formatBridgeError } from './bridge-client'
import { el, replaceContent } from './dom-helpers'

function slugifyPackId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export type PacksTabController = {
  load(scope?: SkillPackScope): Promise<void>
  render(
    container: HTMLElement,
    ctx: {
      activeWorkspace: WorkspaceContextSummary
      managedSkills: readonly ManagedSkillViewItem[]
      onAfterMutate: () => Promise<void>
      onToast: (message: string) => void
      onPackCountChange: (count: number) => void
    }
  ): void
}

export function createPacksTabController(): PacksTabController {
  let scope: SkillPackScope = 'user'
  let loading = false
  let errorMsg: string | null = null
  let data: PackListOutput | null = null
  let previewState: PackPreviewOutput | null = null
  let busyPackId: string | null = null
  let showSaveCurrent = false
  let showNewPack = false
  let showImport = false
  let newPackMode: 'static' | 'dynamic' = 'static'
  let currentContainer: HTMLElement | null = null
  let lastCtx: Parameters<PacksTabController['render']>[1] | null = null

  // Form states
  let saveCurrentName = ''
  let saveCurrentId = ''
  let saveCurrentDesc = ''
  let newPackName = ''
  let newPackId = ''
  let newPackDesc = ''
  const selectedMembers = new Set<string>()
  let dynamicLogic: 'and' | 'or' = 'and'
  let dynamicConditions: DynamicPackConditionV2[] = [
    { field: 'tag', op: 'eq', value: '' }
  ]
  let importJsonText = ''
  let importStrategy: 'rename' | 'overwrite' | 'reject' = 'rename'

  const rerender = (): void => {
    if (currentContainer && lastCtx) {
      controller.render(currentContainer, lastCtx)
    }
  }

  const controller: PacksTabController = {
    async load(nextScope) {
      if (nextScope) {
        scope = nextScope
      }
      if (lastCtx && !lastCtx.activeWorkspace.isLocalDirectoryAvailable && scope === 'project') {
        scope = 'user'
      }
      loading = true
      errorMsg = null
      rerender()
      try {
        data = await bridgeClient.listPacks(scope)
        lastCtx?.onPackCountChange(data.entries.length)
      } catch (error) {
        errorMsg = formatBridgeError(error)
      } finally {
        loading = false
        rerender()
      }
    },

    render(container, ctx) {
      currentContainer = container
      lastCtx = ctx
      if (!ctx.activeWorkspace.isLocalDirectoryAvailable && scope === 'project') {
        scope = 'user'
      }
      if (!data && !loading && !errorMsg) {
        void controller.load(scope)
      }

      const toolbar = el(
        'div',
        { className: 'sm-toolbar' },
        el(
          'select',
          {
            className: 'sm-select',
            'aria-label': 'Pack 作用域',
            onChange: (event) => {
              const val = (event.target as HTMLSelectElement).value as SkillPackScope
              previewState = null
              void controller.load(val)
            }
          },
          el('option', { value: 'user', selected: scope === 'user' }, 'User 全局 Packs'),
          el(
            'option',
            {
              value: 'project',
              selected: scope === 'project',
              disabled: !ctx.activeWorkspace.isLocalDirectoryAvailable
            },
            ctx.activeWorkspace.isLocalDirectoryAvailable
              ? 'Workspace 工作区 Packs'
              : 'Workspace (未打开)'
          )
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'sm-btn sm-btn-primary',
            onClick: () => {
              showSaveCurrent = !showSaveCurrent
              showNewPack = false
              showImport = false
              rerender()
            }
          },
          '将当前启用集保存为 Pack'
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'sm-btn',
            onClick: () => {
              showNewPack = !showNewPack
              showSaveCurrent = false
              showImport = false
              rerender()
            }
          },
          '新建静态 / 动态 Pack'
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'sm-btn',
            onClick: () => {
              showImport = !showImport
              showSaveCurrent = false
              showNewPack = false
              rerender()
            }
          },
          '导入 Pack JSON'
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'sm-btn',
            disabled: loading,
            onClick: () => void controller.load(scope)
          },
          loading ? '加载中…' : '刷新'
        )
      )

      const nodes: HTMLElement[] = [toolbar]

      if (errorMsg) {
        nodes.push(
          el(
            'div',
            { className: 'sm-banner sm-banner-error' },
            el('span', undefined, `Packs 操作失败：${errorMsg}`),
            el(
              'button',
              {
                type: 'button',
                className: 'sm-btn sm-btn-sm',
                onClick: () => {
                  errorMsg = null
                  void controller.load(scope)
                }
              },
              '重试'
            )
          )
        )
      }

      if (showSaveCurrent) {
        nodes.push(
          el(
            'div',
            { className: 'sm-form-card' },
            el('strong', undefined, '将当前已启用受管技能保存为静态 Pack'),
            el(
              'div',
              { className: 'sm-form-row' },
              el(
                'div',
                { className: 'sm-field' },
                el('label', { className: 'sm-field-label' }, 'Pack 名称'),
                el('input', {
                  type: 'text',
                  className: 'sm-input',
                  placeholder: '例如：Frontend Core',
                  value: saveCurrentName,
                  onInput: (e) => {
                    saveCurrentName = (e.target as HTMLInputElement).value
                    if (!saveCurrentId) {
                      saveCurrentId = slugifyPackId(saveCurrentName)
                    }
                  }
                })
              ),
              el(
                'div',
                { className: 'sm-field' },
                el('label', { className: 'sm-field-label' }, 'Pack ID (小写字母/数字/连字符)'),
                el('input', {
                  type: 'text',
                  className: 'sm-input',
                  placeholder: 'frontend-core',
                  value: saveCurrentId,
                  onInput: (e) => {
                    saveCurrentId = (e.target as HTMLInputElement).value
                  }
                })
              ),
              el(
                'div',
                { className: 'sm-field' },
                el('label', { className: 'sm-field-label' }, '说明（可选）'),
                el('input', {
                  type: 'text',
                  className: 'sm-input',
                  placeholder: '用途描述',
                  value: saveCurrentDesc,
                  onInput: (e) => {
                    saveCurrentDesc = (e.target as HTMLInputElement).value
                  }
                })
              )
            ),
            el(
              'div',
              { className: 'sm-form-row' },
              el(
                'button',
                {
                  type: 'button',
                  className: 'sm-btn sm-btn-primary',
                  onClick: () => {
                    const id = slugifyPackId(saveCurrentId || saveCurrentName)
                    if (!id || !saveCurrentName.trim()) {
                      errorMsg = '请填写有效的 Pack 名称与 ID'
                      rerender()
                      return
                    }
                    void bridgeClient
                      .saveCurrentPack({
                        scope,
                        id,
                        name: saveCurrentName.trim(),
                        ...(saveCurrentDesc.trim() ? { description: saveCurrentDesc.trim() } : {})
                      })
                      .then(async () => {
                        showSaveCurrent = false
                        saveCurrentName = ''
                        saveCurrentId = ''
                        saveCurrentDesc = ''
                        ctx.onToast('已保存当前启用集为 Pack')
                        await controller.load(scope)
                      })
                      .catch((err) => {
                        errorMsg = formatBridgeError(err)
                        rerender()
                      })
                  }
                },
                '保存 Pack'
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'sm-btn',
                  onClick: () => {
                    showSaveCurrent = false
                    rerender()
                  }
                },
                '取消'
              )
            )
          )
        )
      }

      if (showNewPack) {
        const managedOnly = ctx.managedSkills
        nodes.push(
          el(
            'div',
            { className: 'sm-form-card' },
            el(
              'div',
              { className: 'sm-section-header' },
              el('strong', undefined, '新建 Pack（仅允许受管技能，Plugin 只读技能已自动隔离）'),
              el(
                'div',
                { className: 'sm-tabs' },
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'sm-tab',
                    'aria-selected': String(newPackMode === 'static'),
                    onClick: () => {
                      newPackMode = 'static'
                      rerender()
                    }
                  },
                  '静态成员'
                ),
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'sm-tab',
                    'aria-selected': String(newPackMode === 'dynamic'),
                    onClick: () => {
                      newPackMode = 'dynamic'
                      rerender()
                    }
                  },
                  '动态规则 (v2)'
                )
              )
            ),
            el(
              'div',
              { className: 'sm-form-row' },
              el(
                'div',
                { className: 'sm-field' },
                el('label', { className: 'sm-field-label' }, '名称'),
                el('input', {
                  type: 'text',
                  className: 'sm-input',
                  value: newPackName,
                  onInput: (e) => {
                    newPackName = (e.target as HTMLInputElement).value
                  }
                })
              ),
              el(
                'div',
                { className: 'sm-field' },
                el('label', { className: 'sm-field-label' }, 'ID'),
                el('input', {
                  type: 'text',
                  className: 'sm-input',
                  placeholder: 'auto-from-name',
                  value: newPackId,
                  onInput: (e) => {
                    newPackId = (e.target as HTMLInputElement).value
                  }
                })
              ),
              el(
                'div',
                { className: 'sm-field' },
                el('label', { className: 'sm-field-label' }, '说明'),
                el('input', {
                  type: 'text',
                  className: 'sm-input',
                  value: newPackDesc,
                  onInput: (e) => {
                    newPackDesc = (e.target as HTMLInputElement).value
                  }
                })
              )
            ),
            newPackMode === 'static'
              ? el(
                  'div',
                  { className: 'sm-matrix-grid' },
                  ...managedOnly.map((skill) =>
                    el(
                      'label',
                      { className: 'sm-agent-cell' },
                      el(
                        'span',
                        { className: 'sm-checkbox-label' },
                        el('input', {
                          type: 'checkbox',
                          checked: selectedMembers.has(skill.id),
                          onChange: (e) => {
                            if ((e.target as HTMLInputElement).checked) {
                              selectedMembers.add(skill.id)
                            } else {
                              selectedMembers.delete(skill.id)
                            }
                          }
                        }),
                        el('span', undefined, skill.name)
                      ),
                      el('span', { className: 'sm-skill-id' }, skill.id)
                    )
                  )
                )
              : el(
                  'div',
                  { className: 'sm-section' },
                  el(
                    'div',
                    { className: 'sm-form-row' },
                    el('span', { className: 'sm-field-label' }, '组合逻辑：'),
                    el(
                      'select',
                      {
                        className: 'sm-select',
                        onChange: (e) => {
                          dynamicLogic = (e.target as HTMLSelectElement).value as 'and' | 'or'
                        }
                      },
                      el('option', { value: 'and', selected: dynamicLogic === 'and' }, '全部满足 (AND)'),
                      el('option', { value: 'or', selected: dynamicLogic === 'or' }, '任一满足 (OR)')
                    ),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'sm-btn sm-btn-sm',
                        onClick: () => {
                          dynamicConditions = [
                            ...dynamicConditions,
                            { field: 'tag', op: 'eq', value: '' }
                          ]
                          rerender()
                        }
                      },
                      '+ 添加条件'
                    )
                  ),
                  ...dynamicConditions.map((cond, idx) =>
                    el(
                      'div',
                      { className: 'sm-form-row' },
                      el(
                        'select',
                        {
                          className: 'sm-select',
                          onChange: (e) => {
                            cond.field = (e.target as HTMLSelectElement).value as DynamicPackConditionV2['field']
                          }
                        },
                        ...(
                          [
                            ['tag', 'tag'],
                            ['author', 'author'],
                            ['sourceKind', 'sourceKind'],
                            ['namePrefix', 'namePrefix'],
                            ['scope', 'scope'],
                            ['agent', 'agent'],
                            ['originRoot', 'originRoot'],
                            ['enabled', 'enabled']
                          ] as const
                        ).map(([val, label]) =>
                          el('option', { value: val, selected: cond.field === val }, label)
                        )
                      ),
                      el(
                        'select',
                        {
                          className: 'sm-select',
                          onChange: (e) => {
                            cond.op = (e.target as HTMLSelectElement).value as DynamicPackConditionV2['op']
                          }
                        },
                        ...(['eq', 'neq', 'in', 'not_in', 'prefix', 'contains'] as const).map((op) =>
                          el('option', { value: op, selected: cond.op === op }, op)
                        )
                      ),
                      el('input', {
                        type: 'text',
                        className: 'sm-input',
                        style: 'flex: 1 1 160px',
                        placeholder: '匹配值（如 security 或 claude,codex）',
                        value: cond.value,
                        onInput: (e) => {
                          cond.value = (e.target as HTMLInputElement).value
                        }
                      }),
                      dynamicConditions.length > 1
                        ? el(
                            'button',
                            {
                              type: 'button',
                              className: 'sm-btn sm-btn-sm sm-btn-danger',
                              onClick: () => {
                                dynamicConditions = dynamicConditions.filter((_, i) => i !== idx)
                                rerender()
                              }
                            },
                            '移除'
                          )
                        : null
                    )
                  )
                ),
            el(
              'div',
              { className: 'sm-form-row' },
              el(
                'button',
                {
                  type: 'button',
                  className: 'sm-btn sm-btn-primary',
                  onClick: () => {
                    const id = slugifyPackId(newPackId || newPackName)
                    if (!id || !newPackName.trim()) {
                      errorMsg = '请填写 Pack 名称与合法 ID'
                      rerender()
                      return
                    }
                    const now = new Date().toISOString()
                    let pack: SkillPackV2
                    if (newPackMode === 'static') {
                      if (selectedMembers.size === 0) {
                        errorMsg = '静态 Pack 至少需要选择 1 个受管技能'
                        rerender()
                        return
                      }
                      pack = {
                        id,
                        name: newPackName.trim(),
                        ...(newPackDesc.trim() ? { description: newPackDesc.trim() } : {}),
                        members: [...selectedMembers],
                        createdAt: now,
                        updatedAt: now
                      }
                    } else {
                      const validConds = dynamicConditions
                        .map((c) => ({ ...c, value: c.value.trim() }))
                        .filter((c) => c.value.length > 0)
                      if (validConds.length === 0) {
                        errorMsg = '动态 Pack 至少需要 1 条有效规则条件'
                        rerender()
                        return
                      }
                      pack = {
                        id,
                        name: newPackName.trim(),
                        ...(newPackDesc.trim() ? { description: newPackDesc.trim() } : {}),
                        dynamic: {
                          logic: dynamicLogic,
                          conditions: validConds
                        },
                        createdAt: now,
                        updatedAt: now
                      }
                    }

                    void bridgeClient
                      .savePack({ scope, pack })
                      .then(async () => {
                        showNewPack = false
                        newPackName = ''
                        newPackId = ''
                        newPackDesc = ''
                        selectedMembers.clear()
                        ctx.onToast('Pack 创建成功')
                        await controller.load(scope)
                      })
                      .catch((err) => {
                        errorMsg = formatBridgeError(err)
                        rerender()
                      })
                  }
                },
                '保存新建 Pack'
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'sm-btn',
                  onClick: () => {
                    showNewPack = false
                    rerender()
                  }
                },
                '取消'
              )
            )
          )
        )
      }

      if (showImport) {
        nodes.push(
          el(
            'div',
            { className: 'sm-form-card' },
            el('strong', undefined, '导入便携 Pack JSON (pmstudio-pack-v1)'),
            el(
              'div',
              { className: 'sm-form-row' },
              el('input', {
                type: 'file',
                accept: '.json,application/json',
                onChange: (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0]
                  if (file) {
                    void file.text().then((text) => {
                      importJsonText = text
                      rerender()
                    })
                  }
                }
              }),
              el(
                'select',
                {
                  className: 'sm-select',
                  onChange: (e) => {
                    importStrategy = (e.target as HTMLSelectElement).value as 'rename' | 'overwrite' | 'reject'
                  }
                },
                el('option', { value: 'rename', selected: importStrategy === 'rename' }, 'ID 冲突时自动重命名'),
                el('option', { value: 'overwrite', selected: importStrategy === 'overwrite' }, 'ID 冲突时覆盖'),
                el('option', { value: 'reject', selected: importStrategy === 'reject' }, 'ID 冲突时拒绝')
              )
            ),
            el('textarea', {
              className: 'sm-textarea',
              rows: 5,
              placeholder: '粘贴导出的 .pmstudio-pack.json 内容…',
              value: importJsonText,
              onInput: (e) => {
                importJsonText = (e.target as HTMLTextAreaElement).value
              }
            }),
            el(
              'div',
              { className: 'sm-form-row' },
              el(
                'button',
                {
                  type: 'button',
                  className: 'sm-btn sm-btn-primary',
                  onClick: () => {
                    try {
                      const bundle = JSON.parse(importJsonText)
                      void bridgeClient
                        .importPack({ scope, bundle, conflictStrategy: importStrategy })
                        .then(async (res) => {
                          showImport = false
                          importJsonText = ''
                          ctx.onToast(`已导入 Pack「${res.pack.name}」`)
                          await controller.load(scope)
                        })
                        .catch((err) => {
                          errorMsg = formatBridgeError(err)
                          rerender()
                        })
                    } catch {
                      errorMsg = 'JSON 格式无效，请检查导入内容'
                      rerender()
                    }
                  }
                },
                '执行导入'
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'sm-btn',
                  onClick: () => {
                    showImport = false
                    rerender()
                  }
                },
                '取消'
              )
            )
          )
        )
      }

      if (loading && !data) {
        nodes.push(el('div', { className: 'sm-skeleton-card' }), el('div', { className: 'sm-skeleton-card' }))
        replaceContent(container, ...nodes)
        return
      }

      if (data) {
        if (data.entries.length === 0) {
          nodes.push(
            el(
              'div',
              { className: 'sm-empty' },
              el('strong', undefined, `当前 ${scope === 'user' ? 'User 全局' : 'Workspace'} 暂无 Pack`),
              el('span', undefined, '可点击上方「将当前启用集保存为 Pack」或「新建静态 / 动态 Pack」开始组合管理。')
            )
          )
        } else {
          const triggerPreview = (id: string, mode: SkillPackOperationMode): void => {
            busyPackId = id
            errorMsg = null
            rerender()
            void bridgeClient
              .previewPack({ scope, id, mode })
              .then((res) => {
                previewState = res
              })
              .catch((err) => {
                errorMsg = formatBridgeError(err)
              })
              .finally(() => {
                busyPackId = null
                rerender()
              })
          }

          nodes.push(
            el(
              'div',
              { className: 'sm-list' },
              ...data.entries.map(({ pack, missing }) => {
                const isDynamic = isDynamicSkillPack(pack)
                const isBusy = busyPackId === pack.id
                const showingPreview = previewState?.id === pack.id ? previewState : null

                return el(
                  'article',
                  { className: 'sm-skill-card' },
                  el(
                    'div',
                    { className: 'sm-skill-top' },
                    el(
                      'div',
                      { className: 'sm-skill-main' },
                      el(
                        'div',
                        { className: 'sm-skill-name-line' },
                        el('span', { className: 'sm-skill-name' }, pack.name),
                        el('span', { className: 'sm-skill-id' }, pack.id),
                        el(
                          'span',
                          { className: `sm-badge ${isDynamic ? 'sm-badge-primary' : ''}` },
                          isDynamic ? '动态规则' : `静态 (${pack.members.length} 个技能)`
                        ),
                        missing.length > 0
                          ? el('span', { className: 'sm-badge sm-badge-warn' }, `缺失 ${missing.length} 项`)
                          : null
                      ),
                      el(
                        'p',
                        { className: 'sm-skill-desc' },
                        pack.description ||
                          (isDynamic
                            ? '按动态条件实时匹配 Vault 受管技能'
                            : `成员：${pack.members.join(', ')}`)
                      )
                    ),
                    el(
                      'div',
                      { className: 'sm-skill-controls' },
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'sm-btn sm-btn-sm',
                          disabled: isBusy,
                          onClick: () => triggerPreview(pack.id, 'apply')
                        },
                        '增量 Apply'
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'sm-btn sm-btn-sm',
                          disabled: isBusy,
                          onClick: () => triggerPreview(pack.id, 'switch')
                        },
                        '整包 Switch'
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'sm-btn sm-btn-sm',
                          disabled: isBusy,
                          onClick: () => {
                            void bridgeClient
                              .exportPack({ scope, id: pack.id })
                              .then((bundle) =>
                                bridgeClient.saveJsonFile(
                                  `${pack.id}.pmstudio-pack.json`,
                                  `${JSON.stringify(bundle, null, 2)}\n`
                                )
                              )
                              .then((status) => {
                                if (status === 'saved') {
                                  ctx.onToast(`已导出 Pack「${pack.name}」`)
                                } else if (status === 'copied') {
                                  ctx.onToast(`已复制 Pack「${pack.name}」JSON 到剪贴板`)
                                }
                              })
                              .catch((err) => {
                                errorMsg = formatBridgeError(err)
                                rerender()
                              })
                          }
                        },
                        '导出'
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'sm-btn sm-btn-sm sm-btn-danger',
                          disabled: isBusy,
                          onClick: () => {
                            busyPackId = pack.id
                            rerender()
                            void bridgeClient
                              .deletePack({ scope, id: pack.id })
                              .then(async () => {
                                if (previewState?.id === pack.id) {
                                  previewState = null
                                }
                                ctx.onToast(`已删除 Pack「${pack.name}」`)
                                await controller.load(scope)
                              })
                              .catch((err) => {
                                errorMsg = formatBridgeError(err)
                              })
                              .finally(() => {
                                busyPackId = null
                                rerender()
                              })
                          }
                        },
                        '删除'
                      )
                    )
                  ),
                  showingPreview
                    ? el(
                        'div',
                        { className: 'sm-diff-box' },
                        el(
                          'strong',
                          undefined,
                          `Diff 预览（${showingPreview.mode === 'apply' ? '增量 Apply' : '整包 Switch'}）：`
                        ),
                        el(
                          'div',
                          undefined,
                          `+ 将启用 (${showingPreview.diff.enable.length}): ${showingPreview.diff.enable.join(', ') || '无'}`
                        ),
                        el(
                          'div',
                          undefined,
                          `- 将停用 (${showingPreview.diff.disable.length}): ${showingPreview.diff.disable.join(', ') || '无'}`
                        ),
                        el(
                          'div',
                          undefined,
                          `= 保持不变 (${showingPreview.diff.keep.length}) · ! 缺失未安装 (${showingPreview.diff.missing.length})`
                        ),
                        el(
                          'div',
                          { className: 'sm-form-row' },
                          el(
                            'button',
                            {
                              type: 'button',
                              className: 'sm-btn sm-btn-primary sm-btn-sm',
                              disabled: isBusy,
                              onClick: () => {
                                busyPackId = pack.id
                                rerender()
                                void bridgeClient
                                  .applyPack({ scope, id: pack.id, mode: showingPreview.mode })
                                  .then(async () => {
                                    previewState = null
                                    ctx.onToast(`已应用 Pack「${pack.name}」`)
                                    await Promise.all([controller.load(scope), ctx.onAfterMutate()])
                                  })
                                  .catch((err) => {
                                    errorMsg = formatBridgeError(err)
                                  })
                                  .finally(() => {
                                    busyPackId = null
                                    rerender()
                                  })
                              }
                            },
                            '确认应用（自动记录 Undo 快照）'
                          ),
                          el(
                            'button',
                            {
                              type: 'button',
                              className: 'sm-btn sm-btn-sm',
                              onClick: () => {
                                previewState = null
                                rerender()
                              }
                            },
                            '取消'
                          )
                        )
                      )
                    : null
                )
              })
            )
          )
        }

        // Undo ring section
        const undoSection = el(
          'section',
          { className: 'sm-section' },
          el('h2', { className: 'sm-section-title' }, `Undo 回滚快照（最多保留 10 槽 · 当前 ${data.undoSnapshots.length} 条）`)
        )
        if (data.undoSnapshots.length === 0) {
          undoSection.appendChild(
            el('p', { className: 'sm-subtitle' }, '暂无可回滚快照；每次应用 Pack 时会自动保存应用前状态。')
          )
        } else {
          undoSection.appendChild(
            el(
              'div',
              { className: 'sm-list' },
              ...data.undoSnapshots.map((snap) =>
                el(
                  'div',
                  { className: 'sm-panel-row' },
                  el(
                    'div',
                    { className: 'sm-agent-summary' },
                    el('strong', undefined, snap.packId),
                    el('span', { className: 'sm-badge' }, snap.mode),
                    el('span', { className: 'sm-subtitle' }, `${snap.createdAt} · 涉及 ${snap.affectedSkillIds.length} 项`)
                  ),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'sm-btn sm-btn-sm',
                      disabled: busyPackId !== null,
                      onClick: () => {
                        busyPackId = snap.undoId
                        rerender()
                        void bridgeClient
                          .rollbackPack({ scope, undoId: snap.undoId })
                          .then(async () => {
                            ctx.onToast(`已回滚至应用「${snap.packId}」前状态`)
                            await Promise.all([controller.load(scope), ctx.onAfterMutate()])
                          })
                          .catch((err) => {
                            errorMsg = formatBridgeError(err)
                          })
                          .finally(() => {
                            busyPackId = null
                            rerender()
                          })
                      }
                    },
                    '一键回滚'
                  )
                )
              )
            )
          )
        }
        nodes.push(undoSection)
      }

      replaceContent(container, ...nodes)
    }
  }

  return controller
}
