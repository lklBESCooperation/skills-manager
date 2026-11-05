"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listInstalledSkillIds = listInstalledSkillIds;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
/**
 * Installed-skill inventory: which skill ids exist as manageable directories in the
 * vault or the canonical root. A skill counts when its entry resolves to a directory.
 */
async function listSkillDirectoryIds(root) {
    const entries = await (0, promises_1.readdir)(root, { withFileTypes: true }).catch(() => []);
    // Why stat on links: readdir Dirents use lstat, so a symlinked skill (e.g. an
    // external library link in canonical) reports isDirectory()=false and would
    // vanish from the installed set.
    const ids = [];
    for (const entry of entries) {
        if (entry.name.startsWith('.')) {
            continue;
        }
        const isDirectory = entry.isDirectory() ||
            (entry.isSymbolicLink() &&
                ((await (0, promises_1.stat)((0, node_path_1.join)(root, entry.name)).catch(() => null))?.isDirectory() ?? false));
        if (isDirectory) {
            ids.push(entry.name);
        }
    }
    return ids.sort();
}
/** A skill is installed when its master lives in the vault OR already sits in canonical. */
async function listInstalledSkillIds(vaultRoot, canonicalRoot) {
    const [vaultIds, canonicalIds] = await Promise.all([
        listSkillDirectoryIds(vaultRoot),
        listSkillDirectoryIds(canonicalRoot)
    ]);
    return [...new Set([...vaultIds, ...canonicalIds])].sort();
}
