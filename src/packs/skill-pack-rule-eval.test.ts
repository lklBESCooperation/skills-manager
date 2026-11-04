import { describe, expect, it } from 'vitest'
import type { DynamicPackRule } from '../contracts/skill-pack-contract'
import { evaluateDynamicPack, dynamicPackMemberIds } from './skill-pack-rule-eval'
import type { SkillVaultEntryLike } from './skill-pack-rule-eval'

function entry(
  overrides: Partial<SkillVaultEntryLike> & Pick<SkillVaultEntryLike, 'id' | 'name'>
): SkillVaultEntryLike {
  return {
    sourceKind: 'adopted',
    tags: [],
    author: null,
    ...overrides
  }
}

function rule(match: DynamicPackRule['match']): DynamicPackRule {
  return { match, logic: 'and' }
}

const INDEX: SkillVaultEntryLike[] = [
  entry({ id: 'blog-draft', name: 'blog-draft', author: 'ann', tags: ['writing'] }),
  entry({ id: 'ann-research', name: 'ann-research', author: 'ann', tags: ['research'] }),
  entry({ id: 'bob-draft', name: 'bob-draft', author: 'bob', tags: ['writing'] }),
  entry({
    id: 'packaged-skills',
    name: 'Packaged Skills',
    sourceKind: 'bundled',
    tags: ['research'],
    author: 'Ann'
  }),
  entry({
    id: 'conflicted',
    name: 'conflicted',
    sourceKind: 'conflict',
    author: 'ann',
    tags: ['writing']
  })
]

describe('evaluateDynamicPack', () => {
  it('T4.1: author=ann and tag∈writing matches only ann writing entries', () => {
    const hits = evaluateDynamicPack(
      rule([
        { field: 'author', op: 'eq', value: 'ann' },
        { field: 'tag', op: 'in', value: 'writing' }
      ]),
      INDEX
    )
    expect(hits.map((e) => e.id)).toEqual(['blog-draft'])
  })

  it('T4.2: empty hit set returns [] without error', () => {
    expect(
      evaluateDynamicPack(rule([{ field: 'author', op: 'eq', value: 'nobody' }]), INDEX)
    ).toEqual([])
    expect(
      dynamicPackMemberIds(rule([{ field: 'tag', op: 'eq', value: 'missing-tag' }]), [])
    ).toEqual([])
  })

  it('T4.3: unknown tag yields empty; author comparison is case-insensitive', () => {
    expect(
      evaluateDynamicPack(rule([{ field: 'tag', op: 'eq', value: 'no-such-tag' }]), INDEX).map(
        (e) => e.id
      )
    ).toEqual([])
    const hits = evaluateDynamicPack(rule([{ field: 'author', op: 'eq', value: 'ANN' }]), INDEX)
    expect(hits.map((e) => e.id)).toEqual(['blog-draft', 'ann-research', 'packaged-skills'])
  })

  it('T4.4: conflict entries are excluded even when rule matches them', () => {
    const hits = evaluateDynamicPack(
      rule([
        { field: 'author', op: 'eq', value: 'ann' },
        { field: 'tag', op: 'eq', value: 'writing' }
      ]),
      INDEX
    )
    expect(hits.map((e) => e.id)).not.toContain('conflicted')
    expect(
      evaluateDynamicPack(rule([{ field: 'sourceKind', op: 'eq', value: 'conflict' }]), INDEX)
    ).toEqual([])
  })

  it('T4.5: index growth changes the hit count with no re-save (two calls, same rule)', () => {
    const authorRule = rule([{ field: 'author', op: 'eq', value: 'ann' }])
    const before = evaluateDynamicPack(authorRule, INDEX).length
    const grown = [
      ...INDEX,
      entry({ id: 'ann-new', name: 'ann-new', author: 'ann', tags: ['writing'] })
    ]
    const after = evaluateDynamicPack(authorRule, grown).length
    expect(after).toBe(before + 1)
  })

  it('namePrefix matches id/name prefixes; sourceKind in-list filters', () => {
    expect(
      evaluateDynamicPack(rule([{ field: 'namePrefix', op: 'prefix', value: 'blog' }]), INDEX).map(
        (e) => e.id
      )
    ).toEqual(['blog-draft'])
    expect(
      evaluateDynamicPack(
        rule([{ field: 'sourceKind', op: 'in', value: 'adopted,bundled' }]),
        INDEX
      ).map((e) => e.id)
    ).toEqual(['blog-draft', 'ann-research', 'bob-draft', 'packaged-skills'])
  })

  it('null author never matches author conditions', () => {
    expect(
      evaluateDynamicPack(rule([{ field: 'author', op: 'eq', value: 'ann' }]), [
        entry({ id: 'anon', name: 'anon', author: null, tags: ['writing'] })
      ])
    ).toEqual([])
  })
})
