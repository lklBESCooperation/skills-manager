import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  SKILL_BRIDGE_METHODS,
  type ManagedSkillViewItem,
  type SkillAgentMatrixInput,
  type SkillAgentMatrixOutput
} from '../contracts/skill-ui-bridge-contract'
import { AgentMatrixCache } from './agent-matrix-cache'
import { bridgeClient } from './bridge-client'

const repoRoot = resolve(__dirname, '../..')

function makeSkill(overrides: Partial<ManagedSkillViewItem> = {}): ManagedSkillViewItem {
  return {
    rowKey: 'user:alpha',
    id: 'alpha',
    name: 'Alpha Skill',
    description: 'Alpha description',
    sourceKind: 'installed',
    scope: 'user',
    groupKind: 'parent-dir',
    groupKey: 'dir:/mock',
    groupLabel: '/mock',
    tags: [],
    author: null,
    copyMode: false,
    effective: 'enabled',
    origin: 'user',
    enabledAgentCount: 1,
    supportedAgentCount: 44,
    ...overrides
  }
}

describe('AgentMatrixCache and on-demand matrix loading', () => {
  it('prefers inline item.agents and item.agentDetails over cache or remote fetch', async () => {
    const cache = new AgentMatrixCache()
    const item = makeSkill({
      agents: { claude: true },
      agentDetails: {
        claude: { effective: 'enabled', origin: 'user' }
      }
    })
    const fetcher = vi.fn<(_input: SkillAgentMatrixInput) => Promise<SkillAgentMatrixOutput>>()
    const onUpdate = vi.fn()

    const resolved = cache.resolve(item)
    expect(resolved?.agents.claude).toBe(true)
    expect(resolved?.agentDetails.claude?.origin).toBe('user')

    await cache.load(item, fetcher, onUpdate)
    expect(fetcher).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('fetches on demand when missing, caches the result, and avoids duplicate requests', async () => {
    const cache = new AgentMatrixCache()
    const item = makeSkill()
    const fetcher = vi.fn(async (input: SkillAgentMatrixInput): Promise<SkillAgentMatrixOutput> => ({
      rowKey: `${input.scope}:${input.skillId}`,
      agents: { claude: true, codex: false },
      agentDetails: {
        claude: { effective: 'enabled', origin: 'user' },
        codex: { effective: 'disabled', origin: 'user' }
      }
    }))
    const onUpdate = vi.fn()

    expect(cache.resolve(item)).toBeNull()
    await cache.load(item, fetcher, onUpdate)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith({ skillId: 'alpha', scope: 'user' })
    expect(onUpdate).toHaveBeenCalledTimes(2)
    expect(cache.isLoading(item.rowKey)).toBe(false)
    expect(cache.getError(item.rowKey)).toBeUndefined()

    const resolved = cache.resolve(item)
    expect(resolved?.agents.claude).toBe(true)
    expect(resolved?.agents.codex).toBe(false)

    await cache.load(item, fetcher, onUpdate)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('captures fetch error and succeeds on retry', async () => {
    const cache = new AgentMatrixCache()
    const item = makeSkill()
    let shouldFail = true
    const fetcher = vi.fn(async (): Promise<SkillAgentMatrixOutput> => {
      if (shouldFail) {
        throw new Error('bridge timeout')
      }
      return {
        rowKey: item.rowKey,
        agents: { claude: true },
        agentDetails: {
          claude: { effective: 'enabled', origin: 'project' }
        }
      }
    })
    const onUpdate = vi.fn()

    await cache.load(item, fetcher, onUpdate, (err) => (err as Error).message)
    expect(cache.resolve(item)).toBeNull()
    expect(cache.getError(item.rowKey)).toBe('bridge timeout')
    expect(cache.isLoading(item.rowKey)).toBe(false)

    shouldFail = false
    await cache.load(item, fetcher, onUpdate, (err) => (err as Error).message)
    expect(cache.getError(item.rowKey)).toBeUndefined()
    expect(cache.resolve(item)?.agents.claude).toBe(true)
  })

  it('invalidates row or all entries and ignores stale in-flight responses', async () => {
    const cache = new AgentMatrixCache()
    const alpha = makeSkill({ rowKey: 'user:alpha', id: 'alpha', scope: 'user' })
    const beta = makeSkill({ rowKey: 'workspace:beta', id: 'beta', scope: 'workspace' })

    let resolveAlpha!: (value: SkillAgentMatrixOutput) => void
    const alphaFetcher = vi.fn(
      () =>
        new Promise<SkillAgentMatrixOutput>((resolvePromise) => {
          resolveAlpha = resolvePromise
        })
    )
    const onUpdate = vi.fn()

    const pendingLoad = cache.load(alpha, alphaFetcher, onUpdate)
    expect(cache.isLoading(alpha.rowKey)).toBe(true)

    // Mutation invalidates alpha while its fetch is in flight.
    cache.invalidateRow(alpha.rowKey)
    expect(cache.isLoading(alpha.rowKey)).toBe(false)

    resolveAlpha({
      rowKey: alpha.rowKey,
      agents: { claude: true },
      agentDetails: {}
    })
    await pendingLoad
    // Stale response must not repopulate cache.
    expect(cache.resolve(alpha)).toBeNull()

    // Populate both and verify invalidateRow vs invalidateAll.
    await cache.load(
      alpha,
      async () => ({ rowKey: alpha.rowKey, agents: { claude: false }, agentDetails: {} }),
      onUpdate
    )
    await cache.load(
      beta,
      async () => ({ rowKey: beta.rowKey, agents: { claude: true }, agentDetails: {} }),
      onUpdate
    )
    expect(cache.has(alpha.rowKey)).toBe(true)
    expect(cache.has(beta.rowKey)).toBe(true)

    cache.invalidateRow(alpha.rowKey)
    expect(cache.has(alpha.rowKey)).toBe(false)
    expect(cache.has(beta.rowKey)).toBe(true)

    cache.invalidateAll()
    expect(cache.has(beta.rowKey)).toBe(false)
  })
})

describe('bridgeClient.getSkillAgentMatrix and UI Chinese Adopt labels', () => {
  it('routes bridgeClient.getSkillAgentMatrix through skills.skill.agentMatrix', async () => {
    const mockOutput: SkillAgentMatrixOutput = {
      rowKey: 'user:alpha',
      agents: { claude: true },
      agentDetails: {}
    }
    const request = vi.fn().mockResolvedValue(mockOutput)
    const prevWindow = (globalThis as { window?: unknown }).window
    ;(globalThis as { window?: unknown }).window = {
      orca: {
        plugin: {
          request
        }
      }
    }

    try {
      const result = await bridgeClient.getSkillAgentMatrix({ skillId: 'alpha', scope: 'user' })
      expect(result).toEqual(mockOutput)
      expect(request).toHaveBeenCalledWith(SKILL_BRIDGE_METHODS.skillAgentMatrix, {
        skillId: 'alpha',
        scope: 'user'
      })
    } finally {
      if (prevWindow === undefined) {
        delete (globalThis as { window?: unknown }).window
      } else {
        ;(globalThis as { window?: unknown }).window = prevWindow
      }
    }
  })

  it('has no remaining untranslated Adopt / Adoptable copy in UI views', async () => {
    const [skillsPageSource, pluginAuditSource, skillsPanelSource] = await Promise.all([
      readFile(resolve(repoRoot, 'src/ui/skills-page.ts'), 'utf8'),
      readFile(resolve(repoRoot, 'src/ui/plugin-audit-view.ts'), 'utf8'),
      readFile(resolve(repoRoot, 'src/ui/skills-panel.ts'), 'utf8')
    ])

    for (const source of [skillsPageSource, pluginAuditSource, skillsPanelSource]) {
      expect(source).not.toContain('Adoptable ·')
      expect(source).not.toContain('Adopt 所选')
      expect(source).not.toContain('一键全部 Adopt')
      expect(source).not.toContain('Adopt 纳管')
    }
    expect(skillsPageSource).toContain('一键全部纳管')
    expect(skillsPageSource).toContain('纳管所选')
    expect(skillsPageSource).toContain('批量纳管失败：')
  })
})
