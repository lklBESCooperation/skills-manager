import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DynamicPackRuleV2Schema, type DynamicSkillPackV2 } from '../contracts/skill-pack-contract'
import { evaluateDynamicPack, type SkillVaultEntryLike } from './skill-pack-rule-eval'
import { SkillPackService } from './skill-pack-service'

const roots: string[] = []
const now = '2026-11-01T00:00:00.000Z'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Pack v2, dynamic SkillPackService apply, undo ring, export/import & manifest', () => {
  it('evaluates v2 8-field / 6-op / 2-level and/or rules while excluding readonly plugin entries', () => {
    const rule = DynamicPackRuleV2Schema.parse({
      logic: 'and',
      conditions: [
        { field: 'scope', op: 'eq', value: 'project' },
        {
          logic: 'or',
          conditions: [
            { field: 'agent', op: 'in', value: 'claude,cursor' },
            { field: 'namePrefix', op: 'contains', value: 'security' }
          ]
        },
        { field: 'tag', op: 'not_in', value: 'deprecated' }
      ]
    })

    const entries: SkillVaultEntryLike[] = [
      {
        id: 'sec-audit',
        name: 'Security Audit',
        sourceKind: 'installed',
        tags: ['audit'],
        author: 'alice',
        scope: 'project',
        agents: ['codex'],
        enabled: true
      },
      {
        id: 'claude-helper',
        name: 'Claude Helper',
        sourceKind: 'adopted',
        tags: ['workflow'],
        author: 'bob',
        scope: 'project',
        agents: ['claude'],
        originRoot: '.claude/skills'
      },
      {
        id: 'old-tool',
        name: 'Old Tool',
        sourceKind: 'adopted',
        tags: ['deprecated'],
        author: 'bob',
        scope: 'project',
        agents: ['claude']
      },
      {
        id: 'plugin-sec',
        name: 'Plugin Security',
        sourceKind: 'bundled',
        tags: ['security'],
        author: 'plugin',
        scope: 'project',
        agents: ['claude'],
        readonly: true
      }
    ]

    const hits = evaluateDynamicPack(rule, entries)
    expect(hits.map((e) => e.id)).toEqual(['sec-audit', 'claude-helper'])
  })

  it('unifies dynamic preview/apply in SkillPackService with UndoRing rollback and sanitized export/import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-pack-v2-'))
    roots.push(root)
    const packsPath = join(root, '.pmstudio', 'packs.json')
    const effective = new Set(['baseline'])
    const entries: SkillVaultEntryLike[] = [
      { id: 'baseline', name: 'Baseline', sourceKind: 'adopted', tags: ['core'], author: 'a' },
      { id: 'sec-one', name: 'Sec One', sourceKind: 'installed', tags: ['security'], author: 'b' }
    ]

    const service = new SkillPackService(packsPath, {
      getCurrent: async () => new Set(effective),
      getInstalled: async () => new Set(entries.map((e) => e.id)),
      getEntries: async () => entries,
      onApplyDiff: async (plan) => {
        for (const id of plan.disable) effective.delete(id)
        for (const id of plan.enable) effective.add(id)
      }
    })

    const dynamicPack: DynamicSkillPackV2 = {
      id: 'sec-pack',
      name: 'Security Pack',
      createdAt: now,
      updatedAt: now,
      dynamic: {
        logic: 'and',
        conditions: [{ field: 'tag', op: 'eq', value: 'security' }]
      }
    }
    await service.save(dynamicPack)

    const dry = await service.apply('sec-pack', 'switch', true)
    expect(dry.hitIds).toEqual(['sec-one'])
    expect(effective).toEqual(new Set(['baseline']))

    const applied = await service.apply('sec-pack', 'switch')
    expect(applied.hitIds).toEqual(['sec-one'])
    expect(applied.undoId).toBeTruthy()
    expect(effective).toEqual(new Set(['sec-one']))

    // Rollback restores baseline
    await service.rollback(applied.undoId)
    expect(effective).toEqual(new Set(['baseline']))

    // Export and import with rename conflict strategy
    const bundle = await service.exportPack('sec-pack', {
      'sec-one': { packageId: 'pkg-sec-1' }
    })
    expect(bundle.format).toBe('pmstudio-pack-v1')
    const imported = await service.importPack(bundle, { conflictStrategy: 'rename' })
    expect(imported.pack.id).not.toBe('sec-pack')
  })

  it('ships valid orca-plugin.json with contributes.pages and contributes.panels pointing to existing UI files', async () => {
    const repoRoot = join(__dirname, '..', '..')
    const raw = await readFile(join(repoRoot, 'orca-plugin.json'), 'utf8')
    const manifest = JSON.parse(raw) as {
      manifestVersion: number
      id: string
      version: string
      execution: string
      contributes: {
        pages: { id: string; entry: string; layout?: string; sidebar?: { placement?: string } }[]
        panels: { id: string; entry: string }[]
      }
    }
    expect(manifest.manifestVersion).toBe(2)
    expect(manifest.id).toBe('skills-manager')
    expect(manifest.version).toBe('0.2.0')
    expect(manifest.execution).toBe('sandboxed-ui')
    expect(manifest.contributes.pages).toHaveLength(1)
    expect(manifest.contributes.pages[0]?.layout).toBe('full-page')
    expect(manifest.contributes.pages[0]?.sidebar?.placement).toBe('primary')
    expect(manifest.contributes.panels).toHaveLength(1)

    await access(join(repoRoot, manifest.contributes.pages[0]!.entry))
    await access(join(repoRoot, manifest.contributes.panels[0]!.entry))
  })
})
