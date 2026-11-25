import {
  AGENT_SKILL_DESCRIPTORS,
  type AgentSkillDescriptor
} from './agent-skill-registry'
import type { TuiAgent } from './tui-agent'

/** Null segments use canonical .agents/skills without a separate placement; IDs match detected Orca agents. */
export type SkillInstallProviderEntry = {
  readonly id: TuiAgent
  readonly displayName: string
  readonly globalSegments: readonly string[] | null
  readonly workspaceSegments: readonly string[] | null
  /** Env var relocating the agent's home (skills in `<home>/skills`). */
  readonly homeEnv?: string
}

function toInstallProviderEntry(descriptor: AgentSkillDescriptor): SkillInstallProviderEntry {
  return Object.freeze({
    id: descriptor.id,
    displayName: descriptor.displayName,
    globalSegments: descriptor.installTargets.globalSegments,
    workspaceSegments: descriptor.installTargets.workspaceSegments,
    ...(descriptor.installTargets.homeEnv ? { homeEnv: descriptor.installTargets.homeEnv } : {})
  })
}

/** Read-only derived projection over `AGENT_SKILL_REGISTRY` for managed install providers. */
export const SKILL_INSTALL_PROVIDERS: readonly SkillInstallProviderEntry[] = Object.freeze(
  AGENT_SKILL_DESCRIPTORS.filter((descriptor) => descriptor.capability === 'managed').map(
    toInstallProviderEntry
  )
)

export type SkillInstallProviderDefinition = (typeof SKILL_INSTALL_PROVIDERS)[number]
export type SkillInstallProviderId = SkillInstallProviderDefinition['id']

const INSTALL_PROVIDER_IDS: ReadonlySet<string> = new Set(
  SKILL_INSTALL_PROVIDERS.map((provider) => provider.id)
)

export function isSkillInstallProviderId(value: string): value is SkillInstallProviderId {
  return INSTALL_PROVIDER_IDS.has(value)
}

/** Explicit choices include agents installed later; removal omits choices to clean every previously used root. */
export function selectedOrDetectedSkillProviders(
  detectedProviders: readonly string[],
  selectedProviders: readonly string[] | undefined
): readonly string[] {
  return selectedProviders ?? detectedProviders
}
