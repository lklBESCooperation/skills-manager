import { describe, expect, it } from 'vitest'
import type { PluginSkillRecord } from '../contracts/plugin-skill-contract'
import type { ManagedSkillViewItem } from '../contracts/skill-ui-bridge-contract'
import {
  applyOptimisticMutation,
  filterManagedSkills,
  filterPluginSkills,
  reconcileMutatedSkills,
  rollbackOptimisticMutation
} from './filter-model'

function makeManaged(overrides: Partial<ManagedSkillViewItem>): ManagedSkillViewItem {
  return {
    rowKey: 'user:alpha',
    id: 'alpha',
    name: 'Alpha Skill',
    description: 'Security auditing helper',
    sourceKind: 'installed',
    scope: 'user',
    tags: ['security'],
    author: 'alice',
    copyMode: false,
    effective: 'enabled',
    origin: 'user',
    enabledAgentCount: 10,
    supportedAgentCount: 44,
    agents: { claude: true },
    agentDetails: {},
    ...overrides
  }
}

describe('filter-model and optimistic rollback', () => {
  it('filters managed and plugin skills by query, scope, and status', () => {
    const items: ManagedSkillViewItem[] = [
      makeManaged({ rowKey: 'user:alpha', id: 'alpha', name: 'Alpha', scope: 'user', effective: 'enabled' }),
      makeManaged({
        rowKey: 'workspace:beta',
        id: 'beta',
        name: 'Beta Formatter',
        description: 'Format code',
        scope: 'workspace',
        effective: 'disabled',
        tags: ['format']
      })
    ]

    expect(filterManagedSkills(items, { query: 'format', scope: 'all', status: 'all' })).toHaveLength(1)
    expect(filterManagedSkills(items, { query: '', scope: 'workspace', status: 'disabled' })).toHaveLength(1)
    expect(filterManagedSkills(items, { query: '', scope: 'user', status: 'disabled' })).toHaveLength(0)

    const plugins: PluginSkillRecord[] = [
      {
        id: 'review',
        name: 'PR Review',
        description: 'Review changes',
        readonly: true,
        sourceCategory: 'plugin',
        pluginId: 'kit@official',
        pluginName: 'kit',
        agent: 'claude',
        scope: 'user',
        installPath: '/p',
        skillDirectoryPath: '/p/skills/review',
        skillFilePath: '/p/skills/review/SKILL.md',
        invocationCommand: '/kit:review',
        activationState: 'active'
      }
    ]
    expect(filterPluginSkills(plugins, '/kit:review')).toHaveLength(1)
    expect(filterPluginSkills(plugins, 'nonexistent')).toHaveLength(0)
  })

  it('supports optimistic mutation, server reconciliation, and failure rollback', () => {
    const original = [
      makeManaged({ rowKey: 'user:alpha', id: 'alpha', effective: 'enabled', origin: 'user' }),
      makeManaged({ rowKey: 'user:beta', id: 'beta', effective: 'enabled', origin: 'user' })
    ]

    const { nextSkills, rollbackSnapshot } = applyOptimisticMutation(
      original,
      new Set(['user:alpha']),
      'disabled',
      'project'
    )
    expect(nextSkills[0]?.effective).toBe('disabled')
    expect(nextSkills[0]?.origin).toBe('project')
    expect(nextSkills[1]?.effective).toBe('enabled')

    const rolledBack = rollbackOptimisticMutation(nextSkills, rollbackSnapshot)
    expect(rolledBack).toEqual(original)

    const serverConfirmed = makeManaged({
      rowKey: 'user:alpha',
      id: 'alpha',
      effective: 'disabled',
      origin: 'project',
      enabledAgentCount: 0
    })
    const reconciled = reconcileMutatedSkills(nextSkills, [serverConfirmed])
    expect(reconciled[0]?.enabledAgentCount).toBe(0)
  })
})
