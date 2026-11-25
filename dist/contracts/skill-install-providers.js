"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SKILL_INSTALL_PROVIDERS = void 0;
exports.isSkillInstallProviderId = isSkillInstallProviderId;
exports.selectedOrDetectedSkillProviders = selectedOrDetectedSkillProviders;
const agent_skill_registry_1 = require("./agent-skill-registry");
function toInstallProviderEntry(descriptor) {
    return Object.freeze({
        id: descriptor.id,
        displayName: descriptor.displayName,
        globalSegments: descriptor.installTargets.globalSegments,
        workspaceSegments: descriptor.installTargets.workspaceSegments,
        ...(descriptor.installTargets.homeEnv ? { homeEnv: descriptor.installTargets.homeEnv } : {})
    });
}
/** Read-only derived projection over `AGENT_SKILL_REGISTRY` for managed install providers. */
exports.SKILL_INSTALL_PROVIDERS = Object.freeze(agent_skill_registry_1.AGENT_SKILL_DESCRIPTORS.filter((descriptor) => descriptor.capability === 'managed').map(toInstallProviderEntry));
const INSTALL_PROVIDER_IDS = new Set(exports.SKILL_INSTALL_PROVIDERS.map((provider) => provider.id));
function isSkillInstallProviderId(value) {
    return INSTALL_PROVIDER_IDS.has(value);
}
/** Explicit choices include agents installed later; removal omits choices to clean every previously used root. */
function selectedOrDetectedSkillProviders(detectedProviders, selectedProviders) {
    return selectedProviders ?? detectedProviders;
}
