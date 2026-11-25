"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listSkillFiles = listSkillFiles;
exports.readSkillFile = readSkillFile;
exports.writeSkillFile = writeSkillFile;
exports.deleteSkillFile = deleteSkillFile;
exports.createLocalSkillInVault = createLocalSkillInVault;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const skill_editor_contract_1 = require("../contracts/skill-editor-contract");
const skill_metadata_1 = require("../contracts/skill-metadata");
const skill_path_containment_1 = require("../contracts/skill-path-containment");
const readonly_root_fence_1 = require("../infra/readonly-root-fence");
const skill_filesystem_retry_1 = require("../infra/skill-filesystem-retry");
const skill_vault_index_service_1 = require("../vault/skill-vault-index-service");
const skill_vault_paths_1 = require("../vault/skill-vault-paths");
const staging_marker_1 = require("../vault/staging-marker");
function assertValidSkillId(skillId) {
    if (!(0, skill_editor_contract_1.validateSkillId)(skillId)) {
        throw new Error(`skill-editor-invalid-id: ${skillId}`);
    }
}
async function resolveSkillRoot(vaultRoot, skillId, readonlyRoots) {
    assertValidSkillId(skillId);
    const semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)();
    const lexicalRoot = (0, skill_vault_paths_1.skillVaultEntryRoot)(vaultRoot, skillId);
    if (!(0, skill_path_containment_1.skillPathInside)(vaultRoot, lexicalRoot, semantics)) {
        throw new Error(`skill-path-escape: ${skillId}`);
    }
    await (0, readonly_root_fence_1.assertWritableSkillTarget)(lexicalRoot, { readonlyRoots, semantics });
    const realRoot = await (0, promises_1.realpath)(lexicalRoot).catch(() => (0, node_path_1.resolve)(lexicalRoot));
    return { lexicalRoot, realRoot };
}
/**
 * Resolves `relativePath` inside a skill directory and blocks lexical `..`, absolute
 * paths, symlinks escaping the skill directory, and readonly plugin targets.
 */
async function resolveContainmentPath(input) {
    const { lexicalRoot, realRoot } = await resolveSkillRoot(input.vaultRoot, input.skillId, input.readonlyRoots);
    const normalizedRel = input.relativePath.replace(/\\/g, '/');
    if (!normalizedRel ||
        normalizedRel.startsWith('/') ||
        /^[A-Za-z]:/.test(normalizedRel) ||
        normalizedRel.includes('\0')) {
        throw new Error(`skill-path-escape: ${input.relativePath}`);
    }
    const candidate = (0, node_path_1.resolve)(lexicalRoot, normalizedRel);
    const semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)();
    if (!(0, skill_path_containment_1.skillPathInside)(lexicalRoot, candidate, semantics)) {
        throw new Error(`skill-path-escape: ${input.relativePath}`);
    }
    await (0, readonly_root_fence_1.assertWritableSkillTarget)(candidate, { readonlyRoots: input.readonlyRoots, semantics });
    // Walk existing path or nearest existing ancestor to ensure no symlink escapes `realRoot`.
    const targetStat = await (0, promises_1.lstat)(candidate).catch(() => null);
    if (targetStat) {
        if (targetStat.isSymbolicLink()) {
            const targetReal = await (0, promises_1.realpath)(candidate).catch(() => null);
            if (!targetReal || !(0, skill_path_containment_1.skillPathInside)(realRoot, targetReal, semantics)) {
                throw new Error(`skill-path-escape: symlink ${input.relativePath}`);
            }
        }
        else {
            const targetReal = await (0, promises_1.realpath)(candidate);
            if (!(0, skill_path_containment_1.skillPathInside)(realRoot, targetReal, semantics) && !(0, skill_path_containment_1.skillPathsEqual)(realRoot, targetReal, semantics)) {
                throw new Error(`skill-path-escape: ${input.relativePath}`);
            }
        }
    }
    else {
        if (!input.allowMissingTarget) {
            throw new Error(`skill-editor-not-found: ${input.relativePath}`);
        }
        let cursor = (0, node_path_1.dirname)(candidate);
        while (!(0, skill_path_containment_1.skillPathsEqual)(cursor, lexicalRoot, semantics)) {
            const ancestorStat = await (0, promises_1.lstat)(cursor).catch(() => null);
            if (ancestorStat) {
                const ancestorReal = await (0, promises_1.realpath)(cursor).catch(() => null);
                if (!ancestorReal ||
                    (!(0, skill_path_containment_1.skillPathInside)(realRoot, ancestorReal, semantics) &&
                        !(0, skill_path_containment_1.skillPathsEqual)(realRoot, ancestorReal, semantics))) {
                    throw new Error(`skill-path-escape: ancestor symlink ${input.relativePath}`);
                }
                break;
            }
            const nextParent = (0, node_path_1.dirname)(cursor);
            if (nextParent === cursor) {
                throw new Error(`skill-path-escape: ${input.relativePath}`);
            }
            cursor = nextParent;
        }
    }
    return candidate;
}
async function syncVaultEntryAfterEdit(scope, skillId) {
    const index = await (0, skill_vault_index_service_1.readSkillVaultIndex)(scope.indexPath);
    const vaultPath = (0, skill_vault_paths_1.skillVaultEntryRoot)(scope.vaultRoot, skillId);
    const markdown = await (0, promises_1.readFile)((0, node_path_1.join)(vaultPath, 'SKILL.md'), 'utf8').catch(() => '');
    const summary = (0, skill_metadata_1.summarizeSkillMarkdown)(markdown);
    const digest = await (0, skill_vault_index_service_1.computeSkillVaultDigest)(vaultPath);
    const sizeBytes = await (0, skill_vault_index_service_1.skillVaultSizeBytes)(vaultPath).catch(() => 0);
    const now = new Date().toISOString();
    const existing = index?.entries.find((item) => item.id === skillId);
    const updatedEntry = existing
        ? {
            ...existing,
            name: summary.name ?? existing.name,
            description: summary.description,
            digest,
            sizeBytes,
            updatedAt: now
        }
        : {
            id: skillId,
            name: summary.name ?? skillId,
            description: summary.description,
            sourceKind: 'installed',
            originPath: null,
            linkPaths: [],
            digest,
            sizeBytes,
            tags: [],
            author: null,
            installedAt: now,
            updatedAt: now
        };
    const nextEntries = [
        ...(index?.entries ?? []).filter((item) => item.id !== skillId),
        updatedEntry
    ];
    return (0, skill_vault_index_service_1.rebuildSkillVaultIndex)(scope.indexPath, nextEntries);
}
async function listSkillFiles(scope, skillId) {
    const { lexicalRoot, realRoot } = await resolveSkillRoot(scope.vaultRoot, skillId, scope.readonlyRoots);
    const semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)();
    const entries = [];
    async function walk(dir) {
        const handle = await (0, promises_1.opendir)(dir);
        const dirents = [];
        try {
            for (;;) {
                const d = await handle.read();
                if (!d)
                    break;
                dirents.push(d);
            }
        }
        finally {
            await handle.close().catch(() => undefined);
        }
        dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const d of dirents) {
            const full = (0, node_path_1.join)(dir, d.name);
            const st = await (0, promises_1.lstat)(full);
            if (st.isSymbolicLink()) {
                const real = await (0, promises_1.realpath)(full).catch(() => null);
                if (!real || !(0, skill_path_containment_1.skillPathInside)(realRoot, real, semantics)) {
                    continue;
                }
            }
            const rel = (0, node_path_1.relative)(lexicalRoot, full).replace(/\\/g, '/');
            if (st.isDirectory()) {
                entries.push({ relativePath: rel, kind: 'directory', sizeBytes: 0 });
                await walk(full);
            }
            else if (st.isFile()) {
                entries.push({ relativePath: rel, kind: 'file', sizeBytes: st.size });
            }
        }
    }
    await walk(lexicalRoot);
    return entries;
}
async function readSkillFile(scope, skillId, relativePath) {
    const target = await resolveContainmentPath({
        vaultRoot: scope.vaultRoot,
        skillId,
        relativePath,
        readonlyRoots: scope.readonlyRoots,
        allowMissingTarget: false
    });
    return (0, promises_1.readFile)(target, 'utf8');
}
async function writeSkillFile(scope, skillId, relativePath, content, options) {
    const normalizedRel = relativePath.replace(/\\/g, '/');
    if (normalizedRel === 'SKILL.md' && options?.validateFrontmatter !== false) {
        const validation = (0, skill_editor_contract_1.validateSkillFrontmatter)(content);
        if (!validation.valid) {
            throw new Error(`skill-editor-invalid-frontmatter: ${validation.errors.join('; ')}`);
        }
    }
    const target = await resolveContainmentPath({
        vaultRoot: scope.vaultRoot,
        skillId,
        relativePath,
        readonlyRoots: scope.readonlyRoots,
        allowMissingTarget: true
    });
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(target), { recursive: true });
    const temp = `${target}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    await (0, promises_1.writeFile)(temp, content, 'utf8');
    try {
        await (0, skill_filesystem_retry_1.renameSkillPathWithWindowsRetry)(temp, target);
    }
    finally {
        await (0, promises_1.rm)(temp, { force: true }).catch(() => undefined);
    }
    await syncVaultEntryAfterEdit(scope, skillId);
    const digest = await (0, skill_vault_index_service_1.computeSkillVaultDigest)((0, skill_vault_paths_1.skillVaultEntryRoot)(scope.vaultRoot, skillId));
    return { path: target, digest };
}
async function deleteSkillFile(scope, skillId, relativePath) {
    const normalizedRel = relativePath.replace(/\\/g, '/');
    if (normalizedRel === 'SKILL.md') {
        throw new Error('skill-editor-cannot-delete-skill-md');
    }
    const target = await resolveContainmentPath({
        vaultRoot: scope.vaultRoot,
        skillId,
        relativePath,
        readonlyRoots: scope.readonlyRoots,
        allowMissingTarget: false
    });
    await (0, promises_1.rm)(target, { recursive: true, force: true });
    await syncVaultEntryAfterEdit(scope, skillId);
}
async function createLocalSkillInVault(scope, input, extraFiles) {
    const parsed = skill_editor_contract_1.SkillCreateWizardInputSchema.parse(input);
    assertValidSkillId(parsed.id);
    const semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)();
    const vaultPath = (0, skill_vault_paths_1.skillVaultEntryRoot)(scope.vaultRoot, parsed.id);
    await (0, readonly_root_fence_1.assertWritableSkillTarget)(vaultPath, {
        readonlyRoots: scope.readonlyRoots,
        semantics
    });
    const exists = await (0, promises_1.lstat)(vaultPath).catch(() => null);
    if (exists) {
        throw new Error(`skill-install-conflict: ${parsed.id}`);
    }
    await (0, promises_1.mkdir)(scope.vaultRoot, { recursive: true });
    const stagePath = (0, node_path_1.join)(scope.vaultRoot, `.${parsed.id}${staging_marker_1.SKILL_VAULT_STAGE_MARKER}${(0, node_crypto_1.randomUUID)()}`);
    try {
        await (0, promises_1.mkdir)(stagePath, { recursive: true });
        const markdown = (0, skill_editor_contract_1.renderSkillMarkdownTemplate)(parsed);
        const validation = (0, skill_editor_contract_1.validateSkillFrontmatter)(markdown);
        if (!validation.valid) {
            throw new Error(`skill-editor-invalid-frontmatter: ${validation.errors.join('; ')}`);
        }
        await (0, promises_1.writeFile)((0, node_path_1.join)(stagePath, 'SKILL.md'), markdown, 'utf8');
        if (extraFiles) {
            for (const extra of extraFiles) {
                const rel = extra.relativePath.replace(/\\/g, '/');
                if (!rel || rel.startsWith('/') || rel.split('/').some((seg) => seg === '..' || seg === '.')) {
                    throw new Error(`skill-path-escape: ${extra.relativePath}`);
                }
                const full = (0, node_path_1.resolve)(stagePath, rel);
                if (!(0, skill_path_containment_1.skillPathInside)(stagePath, full, semantics)) {
                    throw new Error(`skill-path-escape: ${extra.relativePath}`);
                }
                await (0, promises_1.mkdir)((0, node_path_1.dirname)(full), { recursive: true });
                await (0, promises_1.writeFile)(full, extra.content, 'utf8');
            }
        }
        await (0, skill_filesystem_retry_1.renameSkillPathWithWindowsRetry)(stagePath, vaultPath);
        const index = await syncVaultEntryAfterEdit(scope, parsed.id);
        if (index && parsed.tags.length > 0) {
            const updated = index.entries.map((entry) => entry.id === parsed.id
                ? { ...entry, tags: [...parsed.tags], author: parsed.author ?? null }
                : entry);
            await (0, skill_vault_index_service_1.rebuildSkillVaultIndex)(scope.indexPath, updated);
        }
        return {
            id: parsed.id,
            vaultPath,
            index: await (0, skill_vault_index_service_1.readSkillVaultIndex)(scope.indexPath)
        };
    }
    catch (error) {
        await (0, promises_1.rm)(stagePath, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }
}
