/**
 * Staging directory marker shared between skills-manager and PMStudio discovery filters
 * (`SKILL_STAGING_GLOB = '.*.orca-*'`). Any interrupted staging directory is skipped
 * by local and WSL scanners.
 */
export const SKILL_VAULT_STAGE_MARKER = '.orca-stage-'
export const SKILL_STAGING_GLOB = '.*.orca-*'

const STAGING_ENTRY_PATTERN = /^\..+\.(?:orca|pmstage)-/u

export function isSkillStagingEntryName(name: string): boolean {
  return STAGING_ENTRY_PATTERN.test(name)
}
