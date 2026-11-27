import type { PluginSkillRecord } from '../contracts/plugin-skill-contract'
import type { SkillAuditFinding, SkillAuditReport } from '../contracts/skill-audit-contract'
import type { SkillPackScope } from '../contracts/skill-pack-contract'
import type { AgentRegistrySummaryItem, WorkspaceContextSummary } from '../contracts/skill-ui-bridge-contract'
import { bridgeClient, formatBridgeError } from './bridge-client'
import { copyTextSafe, el, replaceContent } from './dom-helpers'
import { filterPluginSkills, formatPluginActivationLabel } from './filter-model'

export function createPluginSkillCard(
  skill: PluginSkillRecord,
  agentMap: ReadonlyMap<string, AgentRegistrySummaryItem>,
  onToast: (message: string) => void
): HTMLElement {
  const agentName = agentMap.get(skill.agent)?.displayName ?? skill.agent
  const scopeLabel =
    skill.scope === 'project' ? 'Project' : skill.scope === 'local' ? 'Local' : 'User'
  const categoryLabel =
    skill.sourceCategory === 'plugin' ? '只读 · 插件内置' : '只读 · 宿主内置'

  const activationClass =
    skill.activationState === 'active'
      ? 'sm-badge-success'
      : skill.activationState === 'wsl-unavailable'
        ? 'sm-badge-warn'
        : ''

  return el(
    'article',
    { className: 'sm-skill-card is-readonly', 'data-readonly-skill': skill.id },
    el(
      'div',
      { className: 'sm-skill-top' },
      el(
        'div',
        { className: 'sm-skill-main' },
        el(
          'div',
          { className: 'sm-skill-name-line' },
          el('span', { className: 'sm-skill-name' }, skill.name || skill.id),
          skill.name && skill.name !== skill.id
            ? el('span', { className: 'sm-skill-id' }, skill.id)
            : null,
          el(
            'span',
            {
              className: 'sm-badge sm-badge-warn',
              title: '插件内置技能受只读保护，请通过对应 Agent 的插件配置管理其启停或卸载。'
            },
            `🔒 ${categoryLabel}`
          ),
          el('span', { className: `sm-badge ${activationClass}` }, formatPluginActivationLabel(skill.activationState))
        ),
        el(
          'p',
          { className: 'sm-skill-desc' },
          skill.description && skill.description.trim() ? skill.description : '暂无描述'
        )
      ),
      el(
        'div',
        { className: 'sm-skill-controls' },
        skill.invocationCommand
          ? el(
              'button',
              {
                type: 'button',
                className: 'sm-btn sm-btn-sm',
                onClick: () => {
                  void copyTextSafe(skill.invocationCommand!).then((ok) =>
                    onToast(ok ? `已复制调用命令 ${skill.invocationCommand}` : '复制失败')
                  )
                }
              },
              '复制命令'
            )
          : null,
        el(
          'button',
          {
            type: 'button',
            className: 'sm-btn sm-btn-sm',
            onClick: () => {
              void copyTextSafe(skill.skillFilePath).then((ok) =>
                onToast(ok ? '已复制 SKILL.md 路径' : '复制失败')
              )
            }
          },
          '复制路径'
        )
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
          { className: 'sm-badge' },
          `来自插件: ${skill.pluginName}${skill.marketplace ? ` · ${skill.marketplace}` : ''}`
        ),
        el('span', { className: 'sm-badge' }, `${agentName} · ${scopeLabel}`),
        skill.invocationCommand
          ? el('code', { className: 'sm-code' }, skill.invocationCommand)
          : null
      ),
      el('span', { className: 'sm-skill-id', title: skill.skillFilePath }, skill.skillFilePath)
    )
  )
}

export type PluginAuditTabController = {
  render(
    container: HTMLElement,
    ctx: {
      activeWorkspace: WorkspaceContextSummary
      pluginSkills: readonly PluginSkillRecord[]
      pluginScanError: string | null
      agentMap: ReadonlyMap<string, AgentRegistrySummaryItem>
      onRescanPlugins: () => Promise<void>
      onToast: (message: string) => void
    }
  ): void
}

function severityBadgeClass(severity: SkillAuditFinding['severity']): string {
  switch (severity) {
    case 'error':
      return 'sm-badge-danger'
    case 'warning':
      return 'sm-badge-warn'
    case 'info':
      return 'sm-badge-primary'
  }
}

export function createPluginAuditTabController(): PluginAuditTabController {
  let auditScope: SkillPackScope = 'user'
  let auditLoading = false
  let auditError: string | null = null
  let auditReport: SkillAuditReport | null = null
  let pluginFilterQuery = ''
  let currentContainer: HTMLElement | null = null
  let lastCtx: Parameters<PluginAuditTabController['render']>[1] | null = null

  const runAudit = async (): Promise<void> => {
    if (auditLoading) {
      return
    }
    auditLoading = true
    auditError = null
    if (currentContainer && lastCtx) {
      controller.render(currentContainer, lastCtx)
    }
    try {
      auditReport = await bridgeClient.runAudit(auditScope)
    } catch (error) {
      auditError = formatBridgeError(error)
    } finally {
      auditLoading = false
      if (currentContainer && lastCtx) {
        controller.render(currentContainer, lastCtx)
      }
    }
  }

  const controller: PluginAuditTabController = {
    render(container, ctx) {
      currentContainer = container
      lastCtx = ctx

      if (!ctx.activeWorkspace.isLocalDirectoryAvailable && auditScope === 'project') {
        auditScope = 'user'
      }

      const scopeSelect = el(
        'select',
        {
          className: 'sm-select',
          'aria-label': '审计作用域',
          onChange: (event) => {
            auditScope = (event.target as HTMLSelectElement).value as SkillPackScope
            auditReport = null
            void runAudit()
          }
        },
        el('option', { value: 'user', selected: auditScope === 'user' }, '全局 (User)'),
        el(
          'option',
          {
            value: 'project',
            selected: auditScope === 'project',
            disabled: !ctx.activeWorkspace.isLocalDirectoryAvailable
          },
          ctx.activeWorkspace.isLocalDirectoryAvailable ? '当前工作区 (Workspace)' : '工作区 (未打开)'
        )
      )

      const toolbar = el(
        'div',
        { className: 'sm-toolbar' },
        scopeSelect,
        el(
          'button',
          {
            type: 'button',
            className: 'sm-btn sm-btn-primary',
            disabled: auditLoading,
            onClick: () => void runAudit()
          },
          auditLoading ? '审计扫描中…' : '运行只读健康度审计'
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'sm-btn',
            onClick: () => void ctx.onRescanPlugins()
          },
          '重新扫描 Plugin 技能'
        )
      )

      const auditSection = el('section', { className: 'sm-section' })
      const auditTitle = el('h2', { className: 'sm-section-title' }, '只读健康度审计')
      auditSection.appendChild(auditTitle)

      if (auditError) {
        auditSection.appendChild(
          el(
            'div',
            { className: 'sm-banner sm-banner-error' },
            el('span', undefined, `健康度审计失败：${auditError}`),
            el(
              'button',
              { type: 'button', className: 'sm-btn sm-btn-sm', onClick: () => void runAudit() },
              '重试'
            )
          )
        )
      } else if (!auditReport && !auditLoading) {
        auditSection.appendChild(
          el(
            'div',
            { className: 'sm-empty' },
            el('strong', undefined, '只读健康度审计（零文件系统改动）'),
            el(
              'span',
              undefined,
              '检测断链（orphan-symlink）、同摘要重复、内容冲突、copyMode 漂移、退役目录与插件同名碰撞。'
            ),
            el(
              'button',
              { type: 'button', className: 'sm-btn sm-btn-primary', onClick: () => void runAudit() },
              '立即运行审计'
            )
          )
        )
      } else if (auditLoading) {
        auditSection.appendChild(el('div', { className: 'sm-skeleton-card' }))
      } else if (auditReport) {
        const s = auditReport.summary
        auditSection.appendChild(
          el(
            'div',
            { className: 'sm-kpi-grid' },
            el('div', { className: 'sm-kpi' }, el('span', { className: 'sm-kpi-val' }, s.totalFindings), el('span', { className: 'sm-kpi-label' }, '发现项总计')),
            el('div', { className: 'sm-kpi' }, el('span', { className: 'sm-kpi-val' }, s.orphanSymlinks), el('span', { className: 'sm-kpi-label' }, '断链')),
            el('div', { className: 'sm-kpi' }, el('span', { className: 'sm-kpi-val' }, s.conflicts), el('span', { className: 'sm-kpi-label' }, '内容冲突')),
            el('div', { className: 'sm-kpi' }, el('span', { className: 'sm-kpi-val' }, s.copyDrifted + s.copyOutdated), el('span', { className: 'sm-kpi-label' }, 'Copy 漂移/过期')),
            el('div', { className: 'sm-kpi' }, el('span', { className: 'sm-kpi-val' }, s.pluginCollisions), el('span', { className: 'sm-kpi-label' }, '插件同名碰撞')),
            el('div', { className: 'sm-kpi' }, el('span', { className: 'sm-kpi-val' }, s.readonlyPluginExposures), el('span', { className: 'sm-kpi-label' }, '只读目录暴露'))
          )
        )
        if (auditReport.findings.length === 0) {
          auditSection.appendChild(
            el(
              'div',
              { className: 'sm-banner' },
              el('span', undefined, '未发现断链、冲突或只读目录暴露，当前技能环境健康。')
            )
          )
        } else {
          auditSection.appendChild(
            el(
              'div',
              { className: 'sm-list' },
              ...auditReport.findings.map((finding) =>
                el(
                  'div',
                  { className: 'sm-skill-card' },
                  el(
                    'div',
                    { className: 'sm-skill-name-line' },
                    el('span', { className: `sm-badge ${severityBadgeClass(finding.severity)}` }, finding.severity),
                    el('span', { className: 'sm-badge sm-badge-mono' }, finding.kind),
                    el('strong', undefined, finding.skillId),
                    finding.agent ? el('span', { className: 'sm-badge' }, finding.agent) : null
                  ),
                  el('p', { className: 'sm-skill-desc' }, finding.message),
                  el('span', { className: 'sm-skill-id' }, finding.path)
                )
              )
            )
          )
        }
      }

      // Plugin Skills readonly catalog
      const pluginSection = el('section', { className: 'sm-section' })
      const filteredPlugins = filterPluginSkills(ctx.pluginSkills, pluginFilterQuery)
      pluginSection.appendChild(
        el(
          'div',
          { className: 'sm-section-header' },
          el(
            'h2',
            { className: 'sm-section-title' },
            `Plugin Skills 只读目录 (${filteredPlugins.length} / ${ctx.pluginSkills.length})`
          ),
          el(
            'div',
            { className: 'sm-search-wrap', style: 'max-width: 280px' },
            el('input', {
              type: 'search',
              className: 'sm-input',
              placeholder: '筛选插件技能、插件名或命令…',
              value: pluginFilterQuery,
              onInput: (event) => {
                pluginFilterQuery = (event.target as HTMLInputElement).value
                controller.render(container, ctx)
              }
            })
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

      if (ctx.pluginScanError) {
        pluginSection.appendChild(
          el(
            'div',
            { className: 'sm-banner sm-banner-error' },
            el('span', undefined, `Plugin 只读技能扫描失败：${ctx.pluginScanError}`),
            el(
              'button',
              {
                type: 'button',
                className: 'sm-btn sm-btn-sm',
                onClick: () => void ctx.onRescanPlugins()
              },
              '重试加载插件技能'
            )
          )
        )
      } else if (filteredPlugins.length === 0) {
        pluginSection.appendChild(
          el(
            'div',
            { className: 'sm-empty' },
            el(
              'span',
              undefined,
              ctx.pluginSkills.length === 0
                ? '未检测到宿主或 Agent 插件内置技能'
                : `未找到符合“${pluginFilterQuery.trim()}”的插件技能`
            )
          )
        )
      } else {
        pluginSection.appendChild(
          el(
            'div',
            { className: 'sm-list' },
            ...filteredPlugins.map((skill) =>
              createPluginSkillCard(skill, ctx.agentMap, ctx.onToast)
            )
          )
        )
      }

      replaceContent(container, toolbar, auditSection, pluginSection)
    }
  }

  return controller
}
