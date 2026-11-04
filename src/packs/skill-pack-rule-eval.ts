import type { DynamicPackRule, DynamicPackRuleCondition } from '../contracts/skill-pack-contract'

// Frozen vault index entry shape (PRD §2.2 + conflict state); defined locally so
// this module lands before the P1 index module and stays dependency-free.
export type SkillVaultEntryLike = {
  id: string
  name: string
  sourceKind: 'adopted' | 'installed' | 'bundled' | 'conflict'
  tags: string[]
  author: string | null
}

const CONFLICT_SOURCE_KIND = 'conflict'

// 'in' conditions carry a comma-separated allowlist in `value`
function allowlist(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function equalsCI(actual: string | null, expected: string): boolean {
  return actual !== null && actual.toLowerCase() === expected.toLowerCase()
}

function oneOfCI(actual: string | null, options: readonly string[]): boolean {
  if (actual === null) {
    return false
  }
  const lowered = actual.toLowerCase()
  return options.some((option) => option.toLowerCase() === lowered)
}

function startsWithCI(actual: string | null, prefix: string): boolean {
  return actual !== null && actual.toLowerCase().startsWith(prefix.toLowerCase())
}

function conditionMatchesEntry(
  condition: DynamicPackRuleCondition,
  entry: SkillVaultEntryLike
): boolean {
  const { op, value } = condition
  switch (condition.field) {
    case 'tag':
      switch (op) {
        case 'eq':
          return entry.tags.includes(value)
        case 'in':
          return allowlist(value).some((tag) => entry.tags.includes(tag))
        case 'prefix':
          return entry.tags.some((tag) => tag.startsWith(value))
      }
      /* fallthrough unreachable */
      return false
    case 'author':
      switch (op) {
        case 'eq':
          return equalsCI(entry.author, value)
        case 'in':
          return oneOfCI(entry.author, allowlist(value))
        case 'prefix':
          return startsWithCI(entry.author, value)
      }
      return false
    case 'sourceKind':
      switch (op) {
        case 'eq':
          return entry.sourceKind === value
        case 'in':
          return allowlist(value).includes(entry.sourceKind)
        case 'prefix':
          return entry.sourceKind.startsWith(value)
      }
      return false
    case 'namePrefix':
      // namePrefix compares against both stable id and display name
      switch (op) {
        case 'eq':
          return entry.id === value || entry.name === value
        case 'in':
          return allowlist(value).some((option) => entry.id === option || entry.name === option)
        case 'prefix':
          return entry.id.startsWith(value) || entry.name.startsWith(value)
      }
      return false
  }
}

/**
 * ⑤ read-time evaluation of a dynamic pack rule against vault index entries.
 * Pure: same rule + same index → same member set; index updates change the
 * result with no re-save (PRD §5.2). Conflict entries never match. Empty hit
 * sets are valid ("author has no new skills yet").
 */
export function evaluateDynamicPack<T extends SkillVaultEntryLike>(
  rule: DynamicPackRule,
  entries: readonly T[]
): T[] {
  return entries.filter(
    (entry) =>
      entry.sourceKind !== CONFLICT_SOURCE_KIND &&
      rule.match.every((condition) => conditionMatchesEntry(condition, entry))
  )
}

export function dynamicPackMemberIds(
  rule: DynamicPackRule,
  entries: readonly SkillVaultEntryLike[]
): string[] {
  return evaluateDynamicPack(rule, entries).map((entry) => entry.id)
}
