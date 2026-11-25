"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SKILL_STAGING_GLOB = exports.SKILL_VAULT_STAGE_MARKER = void 0;
exports.isSkillStagingEntryName = isSkillStagingEntryName;
/**
 * Staging directory marker shared between skills-manager and PMStudio discovery filters
 * (`SKILL_STAGING_GLOB = '.*.orca-*'`). Any interrupted staging directory is skipped
 * by local and WSL scanners.
 */
exports.SKILL_VAULT_STAGE_MARKER = '.orca-stage-';
exports.SKILL_STAGING_GLOB = '.*.orca-*';
const STAGING_ENTRY_PATTERN = /^\..+\.(?:orca|pmstage)-/u;
function isSkillStagingEntryName(name) {
    return STAGING_ENTRY_PATTERN.test(name);
}
