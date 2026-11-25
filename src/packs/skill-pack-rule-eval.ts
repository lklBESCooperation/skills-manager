import {
  isDynamicRuleV2,
  type DynamicPackConditionV2,
  type DynamicPackNestedGroup,
  type DynamicPackRule,
  type DynamicPackRuleCondition,
  type DynamicPackRuleV2
} from '../contracts/skill-pack-contract'

export type SkillVaultEntryLike = {
  id: string
  name: string
  description?: string | null
  sourceKind: 'adopted' | 'installed' | 'bundled' | 'conflict'
  tags: string[]
  author: string | null
  /** Readonly plugin/bundled entries are hard-excluded from dynamic pack evaluation. */
  readonly?: boolean
  scope?: 'user' | 'project'
  agents?: readonly string[]
  originRoot?: string | null
  enabled?: boolean
}

const CONFLICT_SOURCE_KIND = 'conflict'

function allowlist(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function equalsCI(actual: string | null | undefined, expected: string): boolean {
  return actual != null && actual.toLowerCase() === expected.toLowerCase()
}

function oneOfCI(actual: string | null | undefined, options: readonly string[]): boolean {
  if (actual == null) {
    return false
  }
  const lowered = actual.toLowerCase()
  return options.some((option) => option.toLowerCase() === lowered)
}

function startsWithCI(actual: string | null | undefined, prefix: string): boolean {
  return actual != null && actual.toLowerCase().startsWith(prefix.toLowerCase())
}

function containsCI(actual: string | null | undefined, needle: string): boolean {
  return actual != null && actual.toLowerCase().includes(needle.toLowerCase())
}

function matchScalarOp(
  actual: string | null | undefined,
  op: DynamicPackConditionV2['op'],
  value: string,
  caseInsensitive = true
): boolean {
  switch (op) {
    case 'eq':
      return caseInsensitive ? equalsCI(actual, value) : actual === value
    case 'neq':
      return caseInsensitive ? !equalsCI(actual, value) : actual !== value
    case 'in':
      return caseInsensitive
        ? oneOfCI(actual, allowlist(value))
        : actual != null && allowlist(value).includes(actual)
    case 'not_in':
      return caseInsensitive
        ? !oneOfCI(actual, allowlist(value))
        : actual == null || !allowlist(value).includes(actual)
    case 'prefix':
      return caseInsensitive
        ? startsWithCI(actual, value)
        : actual != null && actual.startsWith(value)
    case 'contains':
      return caseInsensitive
        ? containsCI(actual, value)
        : actual != null && actual.includes(value)
  }
}

function matchListOp(
  values: readonly string[],
  op: DynamicPackConditionV2['op'],
  rawValue: string
): boolean {
  const options = allowlist(rawValue)
  switch (op) {
    case 'eq':
      return values.includes(rawValue)
    case 'neq':
      return !values.includes(rawValue)
    case 'in':
      return options.some((opt) => values.includes(opt))
    case 'not_in':
      return options.every((opt) => !values.includes(opt))
    case 'prefix':
      return values.some((val) => val.startsWith(rawValue))
    case 'contains':
      return values.some((val) => val.toLowerCase().includes(rawValue.toLowerCase()))
  }
}

function conditionMatchesEntry(
  condition: DynamicPackRuleCondition | DynamicPackConditionV2,
  entry: SkillVaultEntryLike
): boolean {
  const { op, value } = condition
  switch (condition.field) {
    case 'tag':
      return matchListOp(entry.tags, op, value)
    case 'author':
      return matchScalarOp(entry.author, op, value, true)
    case 'sourceKind':
      return matchScalarOp(entry.sourceKind, op, value, false)
    case 'namePrefix':
      if (op === 'neq' || op === 'not_in') {
        return (
          matchScalarOp(entry.id, op, value, false) &&
          matchScalarOp(entry.name, op, value, false)
        )
      }
      return (
        matchScalarOp(entry.id, op, value, op === 'contains') ||
        matchScalarOp(entry.name, op, value, op === 'contains') ||
        (op === 'contains' && containsCI(entry.description, value))
      )
    case 'scope': {
      const normalizedActual = (entry.scope ?? 'user') === 'project' ? 'project' : 'user'
      const normalizedValue = value.toLowerCase() === 'workspace' ? 'project' : value
      return matchScalarOp(normalizedActual, op, normalizedValue, true)
    }
    case 'agent':
      return matchListOp(entry.agents ?? [], op, value)
    case 'originRoot':
      return matchScalarOp(entry.originRoot, op, value, true)
    case 'enabled': {
      const actual = entry.enabled === undefined ? null : entry.enabled ? 'true' : 'false'
      return matchScalarOp(actual, op, value, true)
    }
  }
}

function evaluateGroup(
  group: DynamicPackNestedGroup | DynamicPackRuleV2,
  entry: SkillVaultEntryLike
): boolean {
  const evaluateItem = (item: DynamicPackConditionV2 | DynamicPackNestedGroup): boolean =>
    'conditions' in item ? evaluateGroup(item, entry) : conditionMatchesEntry(item, entry)
  return group.logic === 'and'
    ? group.conditions.every(evaluateItem)
    : group.conditions.some(evaluateItem)
}

/**
 * ⑤ read-time evaluation of a dynamic pack rule (v1 or v2) against vault index entries.
 * Pure: conflict and readonly plugin entries never match.
 */
export function evaluateDynamicPack<T extends SkillVaultEntryLike>(
  rule: DynamicPackRule | DynamicPackRuleV2,
  entries: readonly T[]
): T[] {
  return entries.filter((entry) => {
    if (entry.readonly === true || entry.sourceKind === CONFLICT_SOURCE_KIND) {
      return false
    }
    return isDynamicRuleV2(rule)
      ? evaluateGroup(rule, entry)
      : rule.match.every((condition) => conditionMatchesEntry(condition, entry))
  })
}

export function dynamicPackMemberIds(
  rule: DynamicPackRule | DynamicPackRuleV2,
  entries: readonly SkillVaultEntryLike[]
): string[] {
  return evaluateDynamicPack(rule, entries).map((entry) => entry.id)
}
