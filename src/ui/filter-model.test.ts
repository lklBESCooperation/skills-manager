import { describe, expect, it } from 'vitest'
import type { PluginSkillRecord } from '../contracts/plugin-skill-contract'
import type { ManagedSkillViewItem } from '../contracts/skill-ui-bridge-contract'
import {
  applyOptimisticMutation,
  filterManagedSkills,
  filterPluginSkills,
  reconcileMutatedSkills,
  reconcileQuickPanelSkills,
  rollbackOptimisticMutation,
  summarizeMutationFeedback
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

  it('surfaces error/warn feedback and rolls back when mutation returns failed/conflicts/readonlyBlocked', () => {
    const original = [
      makeManaged({
        rowKey: 'user:rex',
        id: 'rex',
        name: 'Rex',
        sourceKind: 'canonical-unindexed',
        effective: 'enabled',
        origin: 'user'
      })
    ]

    const { nextSkills, rollbackSnapshot } = applyOptimisticMutation(
      original,
      new Set(['user:rex']),
      'disabled',
      'project'
    )
    expect(nextSkills[0]?.effective).toBe('disabled')

    // Case 1: worker returns status: 'conflict' with failed + unmutated [rex]
    const failedWithServerEcho = {
      status: 'conflict' as const,
      updatedSkills: original,
      conflicts: [],
      readonlyBlocked: [],
      failed: [{ skillId: 'rex', error: 'skill-enablement-unknown-skill: rex' }]
    }
    const feedback1 = summarizeMutationFeedback([failedWithServerEcho], '「Rex」')
    expect(feedback1.kind).toBe('error')
    if (feedback1.kind === 'error') {
      expect(feedback1.message).toContain('skill-enablement-unknown-skill')
    }
    const reconciledPage = reconcileMutatedSkills(
      nextSkills,
      failedWithServerEcho.updatedSkills,
      rollbackSnapshot,
      new Set(['rex'])
    )
    expect(reconciledPage[0]?.effective).toBe('enabled')

    // Case 2: worker returns failed with empty updatedSkills -> rollbackSnapshot restores original
    const reconciledPanel = reconcileQuickPanelSkills(
      nextSkills.map(({ agents: _a, agentDetails: _d, ...rest }) => rest),
      [],
      new Map(
        [...rollbackSnapshot.entries()].map(([k, { agents: _a, agentDetails: _d, ...rest }]) => [
          k,
          rest
        ])
      ),
      new Set(['rex'])
    )
    expect(reconciledPanel[0]?.effective).toBe('enabled')

    // Case 3: conflicts / readonlyBlocked produce warn (never success)
    const conflictFeedback = summarizeMutationFeedback(
      [
        {
          conflicts: [{ skillId: 'rex', provider: 'claude', rootPath: '/x' }],
          readonlyBlocked: [],
          failed: []
        }
      ],
      '「Rex」'
    )
    expect(conflictFeedback.kind).toBe('warn')

    const roFeedback = summarizeMutationFeedback(
      [
        {
          conflicts: [],
          readonlyBlocked: [{ skillId: 'sys', provider: 'codex', rootPath: '/sys' }],
          failed: []
        }
      ],
      '「Sys」'
    )
    expect(roFeedback.kind).toBe('warn')

    // Case 4: clean response produces success
    expect(
      summarizeMutationFeedback([{ conflicts: [], readonlyBlocked: [], failed: [] }], '「Rex」')
    ).toEqual({ kind: 'success' })
  })
})
