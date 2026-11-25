"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPackLocalAgents = detectPackLocalAgents;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const agent_skill_registry_1 = require("../contracts/agent-skill-registry");
const skill_install_providers_1 = require("../contracts/skill-install-providers");
// Pre-pack CLI path: probe provider skills dirs directly. The full preflight
// detection module drags Electron-only deps outside the CLI bundle whitelist.
function detectPackLocalAgents(homeDirectory) {
    const descriptorMap = new Map(agent_skill_registry_1.AGENT_SKILL_DESCRIPTORS.map((d) => [d.id, d]));
    const found = [];
    for (const provider of skill_install_providers_1.SKILL_INSTALL_PROVIDERS) {
        const descriptor = descriptorMap.get(provider.id);
        const candidateSegs = [
            provider.globalSegments ?? ['.agents', 'skills'],
            ...(descriptor?.discoveryOnlyRoots?.globalSegments ?? [])
        ];
        const detected = candidateSegs.some((segments) => {
            try {
                return (0, node_fs_1.statSync)((0, node_path_1.join)(homeDirectory, ...segments)).isDirectory();
            }
            catch {
                return false;
            }
        });
        if (detected && (0, skill_install_providers_1.isSkillInstallProviderId)(provider.id)) {
            found.push(provider.id);
        }
    }
    return found;
}
