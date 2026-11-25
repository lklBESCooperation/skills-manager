import { describe, expect, it } from 'vitest'
import { isSkillEffectiveForAgent, resolveEffectiveSkills } from './skill-enablement'
import { TUI_AGENTS } from './tui-agent'

describe('EffectiveSkillResolution per-agent matrix', () => {
  it('resolves all 45 TuiAgents, inheriting delegates and disabling unsupported aider', () => {
    const resolved = resolveEffectiveSkills({
      installed: ['review'],
      userDefaults: { review: 'enabled' },
      projectOverrides: {},
      userAgentOverrides: {
        review: { claude: false, cursor: true, codex: false }
      },
      includeAgents: true
    })

    const entry = resolved.get('review')
    expect(entry).toBeDefined()
    expect(Object.keys(entry?.agents ?? {})).toHaveLength(TUI_AGENTS.length)
    expect(isSkillEffectiveForAgent(entry, 'claude')).toBe(false)
    // claude-agent-teams delegates to claude
    expect(isSkillEffectiveForAgent(entry, 'claude-agent-teams')).toBe(false)
    expect(isSkillEffectiveForAgent(entry, 'codex')).toBe(false)
    expect(isSkillEffectiveForAgent(entry, 'cursor')).toBe(true)
    // aider is unsupported regardless of user default
    expect(isSkillEffectiveForAgent(entry, 'aider')).toBe(false)
    expect(entry?.agentDetails?.aider?.origin).toBe('unsupported')
  })

  it('enforces borrowed-lock when opencode tries to disable while claude remains enabled', () => {
    const resolved = resolveEffectiveSkills({
      installed: ['review'],
      userDefaults: { review: 'enabled' },
      projectOverrides: {},
      userAgentOverrides: {
        review: { claude: true, opencode: false, copilot: false }
      },
      scope: 'global',
      includeAgents: true
    })

    const entry = resolved.get('review')
    // Global scope: opencode borrows claude -> locked enabled
    expect(entry?.agents?.opencode).toBe(true)
    expect(entry?.agentDetails?.opencode).toEqual({
      effective: 'enabled',
      origin: 'borrowed-lock',
      borrowedFrom: 'claude',
      locked: true
    })
    // Global scope: copilot only borrows claude in workspace scope -> can be disabled globally
    expect(entry?.agents?.copilot).toBe(false)
  })
})
