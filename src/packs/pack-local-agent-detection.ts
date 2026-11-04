import { statSync } from 'node:fs'
import { join } from 'node:path'
import {
  isSkillInstallProviderId,
  SKILL_INSTALL_PROVIDERS,
  type SkillInstallProviderId
} from '../contracts/skill-install-providers'

// Pre-pack CLI path: probe provider skills dirs directly. The full preflight
// detection module drags Electron-only deps outside the CLI bundle whitelist.
export function detectPackLocalAgents(homeDirectory: string): SkillInstallProviderId[] {
  const found: SkillInstallProviderId[] = []
  for (const provider of SKILL_INSTALL_PROVIDERS) {
    // Null segments read the canonical .agents/skills root instead of a private one.
    const segments = provider.globalSegments ?? ['.agents', 'skills']
    try {
      if (statSync(join(homeDirectory, ...segments)).isDirectory()) {
        if (isSkillInstallProviderId(provider.id)) {
          found.push(provider.id)
        }
      }
    } catch {
      // Absent root means the agent is not installed for pack placement.
    }
  }
  return found
}
