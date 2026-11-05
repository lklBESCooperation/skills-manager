import { describe, expect, it } from 'vitest'
import {
  emptySkillVaultIndex,
  parseSkillVaultIndex,
  salvageSkillVaultIndex,
  SkillVaultIndexSchema,
  SKILL_VAULT_SCHEMA_VERSION,
  type SkillVaultEntry,
  type SkillVaultIndex
} from './skill-vault-contract'

const now = '2026-11-01T00:00:00.000Z'

function entry(overrides: Partial<SkillVaultEntry> = {}): SkillVaultEntry {
  return {
    id: 'review',
    name: 'code-review',
    description: 'Review code changes.',
    sourceKind: 'adopted',
    originPath: '/home/demo/.claude/skills/review',
    linkPaths: ['/home/demo/.claude/skills/review'],
    digest: 'a'.repeat(64),
    sizeBytes: 128,
    tags: ['writing'],
    author: null,
    installedAt: now,
    updatedAt: now,
    ...overrides
  }
}

describe('skill vault index contract', () => {
  it('round-trips a valid index through the schema (T1.1)', () => {
    const index: SkillVaultIndex = {
      schemaVersion: SKILL_VAULT_SCHEMA_VERSION,
      entries: [entry(), entry({ id: 'testing', copyMode: true })]
    }

    const parsed = SkillVaultIndexSchema.parse(index)
    expect(parsed).toEqual(index)
    expect(parseSkillVaultIndex(JSON.parse(JSON.stringify(index)))).toEqual(index)
  })

  it('rejects an index whose schemaVersion is wrong (T1.1)', () => {
    const index = {
      schemaVersion: 2,
      entries: [entry()]
    }

    expect(parseSkillVaultIndex(index)).toBeNull()
    expect(SkillVaultIndexSchema.safeParse(index).success).toBe(false)
  })

  it('rejects an entry with a malformed digest (T1.1)', () => {
    expect(
      parseSkillVaultIndex({ schemaVersion: 1, entries: [entry({ digest: 'nothex' })] })
    ).toBeNull()
  })

  it('degrades malformed JSON to null instead of throwing (T1.2)', () => {
    expect(salvageSkillVaultIndex('{not json at all')).toBeNull()
  })

  it('degrades a schema-valid JSON object of the wrong shape to null (T1.2)', () => {
    expect(salvageSkillVaultIndex('{"schemaVersion":1,"entries":[{"id":42}]}')).toBeNull()
    expect(salvageSkillVaultIndex('"a plain string"')).toBeNull()
    expect(salvageSkillVaultIndex('null')).toBeNull()
  })

  it('reads back a serialized index through the salvage path (T1.2)', () => {
    const index = { schemaVersion: SKILL_VAULT_SCHEMA_VERSION, entries: [entry()] }
    expect(salvageSkillVaultIndex(JSON.stringify(index))).toEqual(index)
  })

  it('produces an empty index that still validates', () => {
    expect(parseSkillVaultIndex(emptySkillVaultIndex())).toEqual({
      schemaVersion: 1,
      entries: []
    })
  })
})
