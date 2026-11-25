import { z } from 'zod'
import { AGENT_SKILL_REGISTRY, getAgentBorrowedOwners } from './agent-skill-registry'
import { isTuiAgent, TUI_AGENTS, type TuiAgent } from './tui-agent'

export type AgentId = TuiAgent

/** Tri-state override: project entries may fall back through `inherit` to the user default. */
export type SkillOverride = 'inherit' | 'enabled' | 'disabled'
export type EffectiveSkillState = 'enabled' | 'disabled'
export type SkillEnablementOrigin = 'user' | 'project'
export type EffectiveAgentSkillOrigin =
  | SkillEnablementOrigin
  | 'agent-override'
  | 'borrowed-lock'
  | 'unsupported'

export type EffectiveAgentSkillState = {
  effective: EffectiveSkillState
  origin: EffectiveAgentSkillOrigin
  /** Set when an agent borrows a root owned by another enabled agent (e.g. opencode -> claude). */
  borrowedFrom?: TuiAgent
  locked?: boolean
}

export type EffectiveSkillResolution = {
  effective: EffectiveSkillState
  origin: SkillEnablementOrigin
  /** Per-agent boolean matrix (`agents?: Record<AgentId, boolean>`) when resolved at agent granularity. */
  agents?: Partial<Record<AgentId, boolean>>
  /** Detailed per-agent resolution including lock & origin metadata. */
  agentDetails?: Partial<Record<AgentId, EffectiveAgentSkillState>>
}

export type SkillAgentOverrides = Record<string, Partial<Record<AgentId, boolean>>>

export const SKILL_ENABLEMENT_SCHEMA_VERSION = 1 as const
export const SKILL_ENABLEMENT_V2_SCHEMA_VERSION = 2 as const

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
  agentOverrides?: SkillAgentOverrides
}

export type SkillProjectStateFileValue = {
  schemaVersion: typeof SKILL_ENABLEMENT_SCHEMA_VERSION
  overrides: SkillProjectOverrides
  agentOverrides?: SkillAgentOverrides
}

export type SkillUserDefaultsFileV2Value = {
  schemaVersion: typeof SKILL_ENABLEMENT_V2_SCHEMA_VERSION
  defaults: SkillUserDefaults
  agentOverrides: SkillAgentOverrides
}

export type SkillProjectStateFileV2Value = {
  schemaVersion: typeof SKILL_ENABLEMENT_V2_SCHEMA_VERSION
  overrides: SkillProjectOverrides
  agentOverrides: SkillAgentOverrides
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
    schemaVersion: z.union([
      z.literal(SKILL_ENABLEMENT_SCHEMA_VERSION),
      z.literal(SKILL_ENABLEMENT_V2_SCHEMA_VERSION)
    ]),
    defaults: salvage.salvagingRecord(z.string(), SkillEffectiveStateSchema),
    agentOverrides: z.record(z.string(), z.record(z.string(), z.boolean())).optional()
  })
}

function projectStateFileSchema(salvage: SkillEnablementSalvage) {
  return z.object({
    schemaVersion: z.union([
      z.literal(SKILL_ENABLEMENT_SCHEMA_VERSION),
      z.literal(SKILL_ENABLEMENT_V2_SCHEMA_VERSION)
    ]),
    overrides: salvage.salvagingRecord(z.string(), SkillOverrideSchema),
    agentOverrides: z.record(z.string(), z.record(z.string(), z.boolean())).optional()
  })
}

export type SalvagedSkillEnablementFile<T> = {
  value: T
  agentOverrides?: SkillAgentOverrides
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

function sanitizeAgentOverrides(
  raw: Record<string, Record<string, boolean>> | undefined
): SkillAgentOverrides | undefined {
  if (!raw) {
    return undefined
  }
  const clean: SkillAgentOverrides = {}
  for (const skillId of Object.keys(raw).sort()) {
    if (skillId === '__proto__') {
      continue
    }
    const perAgent = raw[skillId]
    if (!perAgent || typeof perAgent !== 'object') {
      continue
    }
    const filtered: Partial<Record<AgentId, boolean>> = {}
    let hasEntry = false
    for (const agentKey of Object.keys(perAgent).sort()) {
      if (isTuiAgent(agentKey) && typeof perAgent[agentKey] === 'boolean') {
        filtered[agentKey] = perAgent[agentKey]
        hasEntry = true
      }
    }
    if (hasEntry) {
      clean[skillId] = filtered
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined
}

export function parseSkillUserDefaultsFile(
  raw: string | null,
  salvage: SkillEnablementSalvage
): SalvagedSkillEnablementFile<SkillUserDefaults> {
  const { value, droppedPaths } = salvage.collectDrops(() =>
    userDefaultsFileSchema(salvage).safeParse(parsedFileEnvelope(raw))
  )
  if (value.success) {
    const agentOverrides = sanitizeAgentOverrides(value.data.agentOverrides)
    return {
      value: value.data.defaults,
      ...(agentOverrides ? { agentOverrides } : {}),
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
    const agentOverrides = sanitizeAgentOverrides(value.data.agentOverrides)
    return {
      value: value.data.overrides,
      ...(agentOverrides ? { agentOverrides } : {}),
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

function sortedAgentOverrides(overrides?: SkillAgentOverrides): SkillAgentOverrides | undefined {
  if (!overrides) {
    return undefined
  }
  const clean = sanitizeAgentOverrides(overrides as Record<string, Record<string, boolean>>)
  return clean
}

/** Deterministic key order keeps the git-committed project state file diff-stable. */
export function skillUserDefaultsFileValue(
  defaults: Readonly<SkillUserDefaults>,
  agentOverrides?: SkillAgentOverrides
): SkillUserDefaultsFileValue {
  const cleanAgentOverrides = sortedAgentOverrides(agentOverrides)
  return {
    schemaVersion: SKILL_ENABLEMENT_SCHEMA_VERSION,
    defaults: sortedRecord(defaults),
    ...(cleanAgentOverrides ? { agentOverrides: cleanAgentOverrides } : {})
  }
}

export function skillProjectStateFileValue(
  overrides: Readonly<SkillProjectOverrides>,
  agentOverrides?: SkillAgentOverrides
): SkillProjectStateFileValue {
  const cleanAgentOverrides = sortedAgentOverrides(agentOverrides)
  return {
    schemaVersion: SKILL_ENABLEMENT_SCHEMA_VERSION,
    overrides: sortedRecord(overrides),
    ...(cleanAgentOverrides ? { agentOverrides: cleanAgentOverrides } : {})
  }
}

function resolveAgentStatesForSkill(input: {
  skillId: string
  baseEffective: EffectiveSkillState
  baseOrigin: SkillEnablementOrigin
  scope: 'global' | 'workspace'
  userAgentOverrides?: Readonly<SkillAgentOverrides>
  projectAgentOverrides?: Readonly<SkillAgentOverrides>
  agents?: readonly AgentId[]
}): {
  agents: Partial<Record<AgentId, boolean>>
  agentDetails: Partial<Record<AgentId, EffectiveAgentSkillState>>
} {
  const targetAgents = input.agents ?? TUI_AGENTS
  const details: Partial<Record<AgentId, EffectiveAgentSkillState>> = {}
  const userOverrides = input.userAgentOverrides?.[input.skillId]
  const projectOverrides = input.projectAgentOverrides?.[input.skillId]

  // Pass 1: direct agent resolution (skipping delegates and borrow locks)
  for (const agent of TUI_AGENTS) {
    const descriptor = AGENT_SKILL_REGISTRY[agent]
    if (descriptor.capability === 'unsupported') {
      details[agent] = { effective: 'disabled', origin: 'unsupported' }
      continue
    }
    if (descriptor.capability === 'delegate') {
      continue
    }
    const projectValue = projectOverrides?.[agent]
    if (typeof projectValue === 'boolean') {
      details[agent] = {
        effective: projectValue ? 'enabled' : 'disabled',
        origin: 'agent-override'
      }
      continue
    }
    const userValue = userOverrides?.[agent]
    if (typeof userValue === 'boolean') {
      details[agent] = {
        effective: userValue ? 'enabled' : 'disabled',
        origin: 'agent-override'
      }
      continue
    }
    details[agent] = {
      effective: input.baseEffective,
      origin: input.baseOrigin
    }
  }

  // Pass 2: resolve delegates and borrowed-owner visibility locks (Q2)
  for (const agent of TUI_AGENTS) {
    const descriptor = AGENT_SKILL_REGISTRY[agent]
    if (descriptor.capability === 'delegate' && descriptor.delegatesTo) {
      const targetDetail = details[descriptor.delegatesTo]
      details[agent] = targetDetail
        ? { ...targetDetail }
        : { effective: 'disabled', origin: 'unsupported' }
      continue
    }
    const current = details[agent]
    if (!current || current.effective === 'enabled' || descriptor.capability === 'unsupported') {
      continue
    }
    const owners = getAgentBorrowedOwners(agent, input.scope)
    const activeOwner = owners.find((owner) => details[owner]?.effective === 'enabled')
    if (activeOwner) {
      details[agent] = {
        effective: 'enabled',
        origin: 'borrowed-lock',
        borrowedFrom: activeOwner,
        locked: true
      }
    }
  }

  const agents: Partial<Record<AgentId, boolean>> = {}
  const agentDetails: Partial<Record<AgentId, EffectiveAgentSkillState>> = {}
  for (const agent of targetAgents) {
    const detail = details[agent]
    if (detail) {
      agents[agent] = detail.effective === 'enabled'
      agentDetails[agent] = detail
    }
  }
  return { agents, agentDetails }
}

/**
 * Final effective state per installed skill: project override wins, `inherit` and absence fall
 * back to the user default, and an absent user default keeps the install-is-enabled default.
 * When per-agent overrides or `includeAgents` are provided, populates `agents` and `agentDetails`.
 */
export function resolveEffectiveSkills(input: {
  installed: readonly string[]
  userDefaults: Readonly<Record<string, EffectiveSkillState | undefined>>
  projectOverrides: Readonly<Record<string, SkillOverride | undefined>>
  userAgentOverrides?: Readonly<SkillAgentOverrides>
  projectAgentOverrides?: Readonly<SkillAgentOverrides>
  scope?: 'global' | 'workspace'
  agents?: readonly AgentId[]
  includeAgents?: boolean
}): Map<string, EffectiveSkillResolution> {
  const includeMatrix =
    Boolean(input.includeAgents) ||
    Boolean(input.userAgentOverrides && Object.keys(input.userAgentOverrides).length > 0) ||
    Boolean(input.projectAgentOverrides && Object.keys(input.projectAgentOverrides).length > 0)
  const scope = input.scope ?? 'global'
  const resolved = new Map<string, EffectiveSkillResolution>()
  for (const id of input.installed) {
    const override = input.projectOverrides[id]
    const baseEffective: EffectiveSkillState =
      override === 'enabled' || override === 'disabled'
        ? override
        : (input.userDefaults[id] ?? 'enabled')
    const baseOrigin: SkillEnablementOrigin =
      override === 'enabled' || override === 'disabled' ? 'project' : 'user'
    if (!includeMatrix) {
      resolved.set(id, { effective: baseEffective, origin: baseOrigin })
      continue
    }
    const matrix = resolveAgentStatesForSkill({
      skillId: id,
      baseEffective,
      baseOrigin,
      scope,
      userAgentOverrides: input.userAgentOverrides,
      projectAgentOverrides: input.projectAgentOverrides,
      agents: input.agents
    })
    resolved.set(id, {
      effective: baseEffective,
      origin: baseOrigin,
      agents: matrix.agents,
      agentDetails: matrix.agentDetails
    })
  }
  return resolved
}

export function isSkillEffectiveForAgent(
  resolution: EffectiveSkillResolution | undefined,
  agent: AgentId
): boolean {
  if (!resolution) {
    return false
  }
  if (resolution.agents && agent in resolution.agents) {
    return resolution.agents[agent] === true
  }
  const descriptor = AGENT_SKILL_REGISTRY[agent]
  if (descriptor.capability === 'unsupported') {
    return false
  }
  return resolution.effective === 'enabled'
}
