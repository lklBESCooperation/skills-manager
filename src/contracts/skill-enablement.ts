import { z } from 'zod'

/** Tri-state override: project entries may fall back through `inherit` to the user default. */
export type SkillOverride = 'inherit' | 'enabled' | 'disabled'
export type EffectiveSkillState = 'enabled' | 'disabled'
export type SkillEnablementOrigin = 'user' | 'project'

export type EffectiveSkillResolution = {
  effective: EffectiveSkillState
  origin: SkillEnablementOrigin
}

export const SKILL_ENABLEMENT_SCHEMA_VERSION = 1 as const

export const SKILL_OVERRIDE_VALUES = ['inherit', 'enabled', 'disabled'] as const
export const SKILL_EFFECTIVE_VALUES = ['enabled', 'disabled'] as const

export const SkillOverrideSchema = z.enum(SKILL_OVERRIDE_VALUES)
export const SkillEffectiveStateSchema = z.enum(SKILL_EFFECTIVE_VALUES)

export const SKILL_ENABLEMENT_STATE_DIRNAME = '.pmstudio'
export const SKILL_USER_DEFAULTS_FILENAME = 'skills-user-defaults.json'
export const SKILL_PROJECT_STATE_FILENAME = 'skills-state.json'

export type SkillUserDefaults = Record<string, EffectiveSkillState>
export type SkillProjectOverrides = Record<string, SkillOverride>

export type SkillUserDefaultsFileValue = {
  schemaVersion: typeof SKILL_ENABLEMENT_SCHEMA_VERSION
  defaults: SkillUserDefaults
}

export type SkillProjectStateFileValue = {
  schemaVersion: typeof SKILL_ENABLEMENT_SCHEMA_VERSION
  overrides: SkillProjectOverrides
}

// Unknown top-level keys strip (forward-compatible); bad per-skill keys salvage away.
// The zod salvage combinators live host-side (src/shared/zod-salvage); the host injects
// them so this package vendors no copy of that shared implementation.
export type SkillEnablementSalvage = {
  collectDrops: <T>(parse: () => T) => { value: T; droppedPaths: string[] }
  salvagingRecord: <V extends z.ZodType>(
    key: z.ZodType<string>,
    value: V
  ) => z.ZodType<Record<string, z.output<V>>, unknown>
}

function userDefaultsFileSchema(salvage: SkillEnablementSalvage) {
  return z.object({
    schemaVersion: z.literal(SKILL_ENABLEMENT_SCHEMA_VERSION),
    defaults: salvage.salvagingRecord(z.string(), SkillEffectiveStateSchema)
  })
}

function projectStateFileSchema(salvage: SkillEnablementSalvage) {
  return z.object({
    schemaVersion: z.literal(SKILL_ENABLEMENT_SCHEMA_VERSION),
    overrides: salvage.salvagingRecord(z.string(), SkillOverrideSchema)
  })
}

export type SalvagedSkillEnablementFile<T> = {
  value: T
  droppedKeys: string[]
  /** Bytes existed but no usable envelope recovered; the file then reads as empty rather than fatal. */
  unreadable: boolean
}

function parsedFileEnvelope(raw: string | null): unknown {
  if (raw === null) {
    return undefined
  }
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export function parseSkillUserDefaultsFile(
  raw: string | null,
  salvage: SkillEnablementSalvage
): SalvagedSkillEnablementFile<SkillUserDefaults> {
  const { value, droppedPaths } = salvage.collectDrops(() =>
    userDefaultsFileSchema(salvage).safeParse(parsedFileEnvelope(raw))
  )
  if (value.success) {
    return {
      value: value.data.defaults,
      droppedKeys: droppedPaths,
      unreadable: false
    }
  }
  return { value: {}, droppedKeys: droppedPaths, unreadable: raw !== null }
}

export function parseSkillProjectStateFile(
  raw: string | null,
  salvage: SkillEnablementSalvage
): SalvagedSkillEnablementFile<SkillProjectOverrides> {
  const { value, droppedPaths } = salvage.collectDrops(() =>
    projectStateFileSchema(salvage).safeParse(parsedFileEnvelope(raw))
  )
  if (value.success) {
    return {
      value: value.data.overrides,
      droppedKeys: droppedPaths,
      unreadable: false
    }
  }
  return { value: {}, droppedKeys: droppedPaths, unreadable: raw !== null }
}

function sortedRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  const sorted: Record<string, T> = {}
  for (const key of Object.keys(record).sort()) {
    if (key === '__proto__') {
      continue
    }
    sorted[key] = record[key]
  }
  return sorted
}

/** Deterministic key order keeps the git-committed project state file diff-stable. */
export function skillUserDefaultsFileValue(
  defaults: Readonly<SkillUserDefaults>
): SkillUserDefaultsFileValue {
  return {
    schemaVersion: SKILL_ENABLEMENT_SCHEMA_VERSION,
    defaults: sortedRecord(defaults)
  }
}

export function skillProjectStateFileValue(
  overrides: Readonly<SkillProjectOverrides>
): SkillProjectStateFileValue {
  return {
    schemaVersion: SKILL_ENABLEMENT_SCHEMA_VERSION,
    overrides: sortedRecord(overrides)
  }
}

/**
 * Final effective state per installed skill: project override wins, `inherit` and absence fall
 * back to the user default, and an absent user default keeps the install-is-enabled default.
 * Keys naming skills outside `installed` are ignored by construction.
 */
export function resolveEffectiveSkills(input: {
  installed: readonly string[]
  userDefaults: Readonly<Record<string, EffectiveSkillState | undefined>>
  projectOverrides: Readonly<Record<string, SkillOverride | undefined>>
}): Map<string, EffectiveSkillResolution> {
  const resolved = new Map<string, EffectiveSkillResolution>()
  for (const id of input.installed) {
    const override = input.projectOverrides[id]
    if (override === 'enabled' || override === 'disabled') {
      resolved.set(id, { effective: override, origin: 'project' })
      continue
    }
    resolved.set(id, {
      effective: input.userDefaults[id] ?? 'enabled',
      origin: 'user'
    })
  }
  return resolved
}
