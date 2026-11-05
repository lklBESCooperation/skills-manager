"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizedSkillVaultPath = normalizedSkillVaultPath;
exports.userSkillVaultRoot = userSkillVaultRoot;
exports.userSkillVaultIndexPath = userSkillVaultIndexPath;
exports.projectSkillVaultRoot = projectSkillVaultRoot;
exports.projectSkillVaultIndexPath = projectSkillVaultIndexPath;
exports.skillVaultEntryRoot = skillVaultEntryRoot;
const node_path_1 = require("node:path");
// ② skills vault roots (PRD §2.1). Same normalization semantics as
// skill-provider-destinations.ts so path comparisons never drift by platform.
function normalizedSkillVaultPath(path) {
    const normalized = (0, node_path_1.resolve)(path);
    return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}
function userSkillVaultRoot(homeDirectory) {
    return (0, node_path_1.join)(homeDirectory, '.pmstudio', 'skills');
}
function userSkillVaultIndexPath(homeDirectory) {
    return (0, node_path_1.join)(homeDirectory, '.pmstudio', 'skills-index.json');
}
function projectSkillVaultRoot(workspaceDirectory) {
    return (0, node_path_1.join)(workspaceDirectory, '.pmstudio', 'skills');
}
function projectSkillVaultIndexPath(workspaceDirectory) {
    return (0, node_path_1.join)(workspaceDirectory, '.pmstudio', 'skills', 'skills-index.json');
}
function skillVaultEntryRoot(vaultRoot, id) {
    return (0, node_path_1.join)(vaultRoot, id);
}
