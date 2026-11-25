/**
 * Staging directory marker shared between skills-manager and PMStudio discovery filters
 * (`SKILL_STAGING_GLOB = '.*.orca-*'`). Any interrupted staging directory is skipped
 * by local and WSL scanners.
 */
export declare const SKILL_VAULT_STAGE_MARKER = ".orca-stage-";
export declare const SKILL_STAGING_GLOB = ".*.orca-*";
export declare function isSkillStagingEntryName(name: string): boolean;
