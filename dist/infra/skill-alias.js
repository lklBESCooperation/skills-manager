"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNativeSkillAlias = createNativeSkillAlias;
// Ported createNativeSkillAlias from src/main/skills/skill-placement-reconciliation.ts
// (upstream-shared); preserves Vault master symlinks without dereferencing the master itself.
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
async function createNativeSkillAlias(canonicalPath, destinationPath) {
    const parent = (0, node_path_1.dirname)(destinationPath);
    await (0, promises_1.mkdir)(parent, { recursive: true });
    if (process.platform === 'win32') {
        await (0, promises_1.symlink)((0, node_path_1.resolve)(canonicalPath), destinationPath, 'junction');
        return;
    }
    const realParent = await (0, promises_1.realpath)(parent).catch(() => (0, node_path_1.resolve)(parent));
    const realCanonicalParent = await (0, promises_1.realpath)((0, node_path_1.dirname)(canonicalPath)).catch(() => (0, node_path_1.resolve)((0, node_path_1.dirname)(canonicalPath)));
    const targetPath = (0, node_path_1.join)(realCanonicalParent, (0, node_path_1.basename)(canonicalPath));
    await (0, promises_1.symlink)((0, node_path_1.relative)(realParent, targetPath), destinationPath, 'dir');
}
