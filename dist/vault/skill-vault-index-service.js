"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptySkillVaultIndex = void 0;
exports.readSkillVaultIndex = readSkillVaultIndex;
exports.writeSkillVaultIndex = writeSkillVaultIndex;
exports.rebuildSkillVaultIndex = rebuildSkillVaultIndex;
exports.computeSkillVaultDigest = computeSkillVaultDigest;
exports.skillVaultSizeBytes = skillVaultSizeBytes;
exports.detectSkillVaultCopyMode = detectSkillVaultCopyMode;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_crypto_1 = require("node:crypto");
const skill_vault_contract_1 = require("../contracts/skill-vault-contract");
Object.defineProperty(exports, "emptySkillVaultIndex", { enumerable: true, get: function () { return skill_vault_contract_1.emptySkillVaultIndex; } });
const skill_filesystem_retry_1 = require("../infra/skill-filesystem-retry");
const skill_package_identity_1 = require("../infra/skill-package-identity");
// ② vault index IO + digest + copy-mode probe (PRD §8 1.7). The digest reuses
// observeSkillPackage so adopt, share manifests, and dedup all agree by construction.
async function readSkillVaultIndex(indexPath) {
    const raw = await (0, promises_1.readFile)(indexPath, 'utf8').catch(() => null);
    // A corrupt index is derived state: degrade to null and let the caller rebuild.
    return raw === null ? null : (0, skill_vault_contract_1.salvageSkillVaultIndex)(raw);
}
async function writeSkillVaultIndex(indexPath, index) {
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(indexPath), { recursive: true, mode: 0o700 });
    const temporary = `${indexPath}.${process.pid}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    await (0, promises_1.writeFile)(temporary, `${JSON.stringify(index)}\n`, 'utf8');
    try {
        await (0, skill_filesystem_retry_1.renameSkillPathWithWindowsRetry)(temporary, indexPath);
    }
    finally {
        await (0, promises_1.rm)(temporary, { force: true }).catch(() => undefined);
    }
}
async function rebuildSkillVaultIndex(indexPath, entries) {
    const index = {
        schemaVersion: skill_vault_contract_1.SKILL_VAULT_SCHEMA_VERSION,
        entries: [...entries].sort((left, right) => left.id.localeCompare(right.id))
    };
    await writeSkillVaultIndex(indexPath, index);
    return index;
}
/** Whole-tree LF-normalized sha256, identical to the share-manifest package digest. */
async function computeSkillVaultDigest(skillDirectory) {
    const observed = await (0, skill_package_identity_1.observeSkillPackage)(skillDirectory);
    return observed.observedDigest;
}
async function skillVaultSizeBytes(skillDirectory) {
    const observed = await (0, skill_package_identity_1.observeSkillPackage)(skillDirectory);
    return observed.files.reduce((total, file) => total + file.size, 0);
}
/**
 * Probe once per process whether this host accepts a directory symlink/junction
 * inside the vault root. On failure (Windows without privilege, exFAT, WSL
 * cross-filesystem) the vault degrades to copy mode (PRD §2.3).
 */
async function detectSkillVaultCopyMode(vaultRoot) {
    const probeName = `.pmstudio-link-probe-${(0, node_crypto_1.randomUUID)()}`;
    const probeTarget = (0, node_path_1.join)(vaultRoot, `.pmstudio-probe-target-${(0, node_crypto_1.randomUUID)()}`);
    const probeLink = (0, node_path_1.join)(vaultRoot, probeName);
    await (0, promises_1.mkdir)(vaultRoot, { recursive: true });
    try {
        await (0, promises_1.mkdir)(probeTarget);
        const linkType = process.platform === 'win32' ? 'junction' : 'dir';
        await (0, promises_1.symlink)(probeTarget, probeLink, linkType);
        return false;
    }
    catch {
        return true;
    }
    finally {
        await (0, promises_1.rm)(probeLink, { recursive: true, force: true }).catch(() => undefined);
        await (0, promises_1.rm)(probeTarget, { recursive: true, force: true }).catch(() => undefined);
    }
}
