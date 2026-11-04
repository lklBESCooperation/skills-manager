import { describe, expect, it } from 'vitest'
import type { DynamicSkillPack, SkillPackPreviewDiff } from '../contracts/skill-pack-contract'
import {
  applyDynamicSkillPack,
  previewDynamicSkillPack,
  previewSkillPack
} from './skill-pack-dynamic'
import type { SkillVaultEntryLike } from './skill-pack-rule-eval'

// Mirrors P3 3.3 skill-pack-preview semantics (frozen output shape); injected
// while that module is unmerged — T4.6 asserts against this fake, the seam
// swaps to the real export at the TODO in skill-pack-dynamic.ts.
function fakePreview(
  currentEnabledIds: readonly string[],
  memberIds: readonly string[],
  mode: 'apply' | 'switch'
): SkillPackPreviewDiff {
  const current = new Set(currentEnabledIds)
  const members = new Set(memberIds)
  const enable = [...members].filter((id) => !current.has(id))
  const keep = [...members].filter((id) => current.has(id))
  const disable = mode === 'switch' ? [...current].filter((id) => !members.has(id)) : []
  const missing: string[] = []
  return { enable, disable, keep, missing }
}

const entries: SkillVaultEntryLike[] = [
  { id: 'ann-blog', name: 'ann-blog', sourceKind: 'adopted', tags: ['writing'], author: 'ann' },
  { id: 'ann-report', name: 'ann-report', sourceKind: 'adopted', tags: ['writing'], author: 'ann' },
  { id: 'bob-tool', name: 'bob-tool', sourceKind: 'installed', tags: ['tooling'], author: 'bob' }
]

const dynamicPack: DynamicSkillPack = {
  id: 'ann-writing',
  name: 'Ann Writing',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  dynamic: {
    match: [
      { field: 'author', op: 'eq', value: 'ann' },
      { field: 'tag', op: 'in', value: 'writing' }
    ],
    logic: 'and'
  }
}

describe('dynamic pack service integration', () => {
  it('T4.6: switch preview carries the hit list and correct diff', () => {
    const preview = previewDynamicSkillPack({
      pack: dynamicPack,
      entries,
      currentEnabledIds: ['ann-blog', 'bob-tool'],
      mode: 'switch',
      computeDiff: fakePreview
    })
    expect(preview.hitIds).toEqual(['ann-blog', 'ann-report'])
    expect(preview.hitEntries?.map((e) => e.name)).toEqual(['ann-blog', 'ann-report'])
    expect(preview.diff).toEqual({
      enable: ['ann-report'],
      disable: ['bob-tool'],
      keep: ['ann-blog'],
      missing: []
    })
  })

  it('T4.6: confirmed apply lands exactly the previewed hit list via the static path', () => {
    const applied: string[][] = []
    const result = applyDynamicSkillPack({
      pack: dynamicPack,
      entries,
      currentEnabledIds: ['ann-blog', 'bob-tool'],
      mode: 'switch',
      computeDiff: fakePreview,
      applyMembers: (memberIds) => {
        applied.push([...memberIds])
        return { ok: true }
      }
    })
    expect(applied).toEqual([['ann-blog', 'ann-report']])
    expect(result.appliedMemberIds).toEqual(result.hitIds)
    expect(result.diff.keep).toEqual(['ann-blog'])
  })

  it('dispatch: static packs keep stored members and gain no hitIds', () => {
    const preview = previewSkillPack({
      pack: {
        id: 'fixed',
        name: 'Fixed',
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
        members: ['ann-blog']
      },
      entries,
      currentEnabledIds: [],
      mode: 'apply',
      computeDiff: fakePreview
    })
    expect(preview.enable).toEqual(['ann-blog'])
    expect(preview.hitIds).toBeUndefined()
  })

  it('apply mode never disables and empty hits apply nothing', () => {
    const result = applyDynamicSkillPack({
      pack: dynamicPack,
      entries: [], // empty index → 命中 0
      currentEnabledIds: ['ann-blog'],
      mode: 'apply',
      computeDiff: fakePreview,
      applyMembers: () => undefined
    })
    expect(result.hitIds).toEqual([])
    expect(result.appliedMemberIds).toEqual([])
    expect(result.diff).toEqual({ enable: [], disable: [], keep: [], missing: [] })
  })
})
