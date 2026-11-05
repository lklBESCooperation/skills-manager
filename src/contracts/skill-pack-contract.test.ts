import { describe, expect, it } from 'vitest'
import {
  DynamicPackRuleSchema,
  DynamicSkillPackSchema,
  SkillPackSchema,
  StaticSkillPackSchema
} from './skill-pack-contract'

const base = {
  id: 'ann-writing',
  name: 'Ann Writing',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z'
}

describe('dynamic pack rule contract', () => {
  it('accepts a rule with and logic and multiple conditions', () => {
    expect(
      DynamicPackRuleSchema.parse({
        match: [
          { field: 'author', op: 'eq', value: 'ann' },
          { field: 'tag', op: 'in', value: 'writing' }
        ],
        logic: 'and'
      })
    ).toMatchObject({ logic: 'and' })
  })

  it('rejects empty match arrays and non-and logic (v1)', () => {
    expect(() => DynamicPackRuleSchema.parse({ match: [], logic: 'and' })).toThrow()
    expect(() =>
      DynamicPackRuleSchema.parse({ match: [{ field: 'tag', op: 'eq', value: 'x' }], logic: 'or' })
    ).toThrow()
    expect(() =>
      DynamicPackRuleSchema.parse({
        match: [{ field: 'tag', op: 'regex', value: 'x' }],
        logic: 'and'
      })
    ).toThrow()
  })

  it('dynamic branch round-trips; members stay absent', () => {
    const pack = DynamicSkillPackSchema.parse({
      ...base,
      dynamic: { match: [{ field: 'tag', op: 'eq', value: 'writing' }], logic: 'and' }
    })
    expect(SkillPackSchema.parse(pack)).toEqual(pack)
    expect('members' in pack).toBe(false)
  })

  it('rejects a definition carrying both dynamic rule and stored members', () => {
    expect(() =>
      SkillPackSchema.parse({
        ...base,
        members: ['a'],
        dynamic: { match: [{ field: 'tag', op: 'eq', value: 'writing' }], logic: 'and' }
      })
    ).toThrow()
  })

  it('static pack shape is untouched by the dynamic branch', () => {
    expect(() => StaticSkillPackSchema.parse({ ...base, members: ['a', 'b'] })).not.toThrow()
    expect(() => StaticSkillPackSchema.parse({ ...base, members: [] })).toThrow()
  })
})
