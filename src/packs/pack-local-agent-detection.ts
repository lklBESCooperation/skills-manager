import { statSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_SKILL_DESCRIPTORS } from '../contracts/agent-skill-registry'
import {
  isSkillInstallProviderId,
  SKILL_INSTALL_PROVIDERS,
  type SkillInstallProviderId
} from '../contracts/skill-install-providers'

// Pre-pack CLI path: probe provider skills dirs directly. The full preflight
// detection module drags Electron-only deps outside the CLI bundle whitelist.
export function detectPackLocalAgents(homeDirectory: string): SkillInstallProviderId[] {
  const descriptorMap = new Map(AGENT_SKILL_DESCRIPTORS.map((d) => [d.id, d]))
  const found: SkillInstallProviderId[] = []
  for (const provider of SKILL_INSTALL_PROVIDERS) {
    const descriptor = descriptorMap.get(provider.id)
    const candidateSegs: (readonly string[])[] = [
      provider.globalSegments ?? ['.agents', 'skills'],
      ...(descriptor?.discoveryOnlyRoots?.globalSegments ?? [])
    ]
    const detected = candidateSegs.some((segments) => {
      try {
        return statSync(join(homeDirectory, ...segments)).isDirectory()
      } catch {
        return false
      }
    })
    if (detected && isSkillInstallProviderId(provider.id)) {
      found.push(provider.id)
    }
  }
  return found
}
