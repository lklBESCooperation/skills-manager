"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPackLocalAgents = detectPackLocalAgents;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const skill_install_providers_1 = require("../contracts/skill-install-providers");
// Pre-pack CLI path: probe provider skills dirs directly. The full preflight
// detection module drags Electron-only deps outside the CLI bundle whitelist.
function detectPackLocalAgents(homeDirectory) {
    const found = [];
    for (const provider of skill_install_providers_1.SKILL_INSTALL_PROVIDERS) {
        // Null segments read the canonical .agents/skills root instead of a private one.
        const segments = provider.globalSegments ?? ['.agents', 'skills'];
        try {
            if ((0, node_fs_1.statSync)((0, node_path_1.join)(homeDirectory, ...segments)).isDirectory()) {
                if ((0, skill_install_providers_1.isSkillInstallProviderId)(provider.id)) {
                    found.push(provider.id);
                }
            }
        }
        catch {
            // Absent root means the agent is not installed for pack placement.
        }
    }
    return found;
}
