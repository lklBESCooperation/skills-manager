"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillCatalogService = void 0;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const skill_catalog_contract_1 = require("../contracts/skill-catalog-contract");
const skill_editor_contract_1 = require("../contracts/skill-editor-contract");
const skill_metadata_1 = require("../contracts/skill-metadata");
const skill_path_containment_1 = require("../contracts/skill-path-containment");
const readonly_root_fence_1 = require("../infra/readonly-root-fence");
const skill_filesystem_retry_1 = require("../infra/skill-filesystem-retry");
const skill_package_identity_1 = require("../infra/skill-package-identity");
const skill_vault_index_service_1 = require("../vault/skill-vault-index-service");
const skill_vault_paths_1 = require("../vault/skill-vault-paths");
const staging_marker_1 = require("../vault/staging-marker");
function assertNotAborted(signal) {
    if (signal?.aborted) {
        throw new Error('skill-install-cancelled');
    }
}
function safeStageRelativePath(stageRoot, relativePath) {
    const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!cleaned || cleaned.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
        throw new Error(`skill-path-escape: ${relativePath}`);
    }
    const target = (0, node_path_1.resolve)(stageRoot, cleaned);
    if (!(0, skill_path_containment_1.skillPathInside)(stageRoot, target, (0, skill_path_containment_1.nativeSkillPathSemantics)())) {
        throw new Error(`skill-path-escape: ${relativePath}`);
    }
    return target;
}
function inferSkillId(raw) {
    const normalized = raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!(0, skill_editor_contract_1.validateSkillId)(normalized)) {
        throw new Error(`skill-install-name-invalid: ${raw}`);
    }
    return normalized;
}
class SkillCatalogService {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async leaderboard(query = {}, signal) {
        const parsed = skill_catalog_contract_1.CatalogLeaderboardQuerySchema.parse(query);
        return this.transport.fetchLeaderboard(parsed, signal);
    }
    async search(query, signal) {
        const parsed = skill_catalog_contract_1.CatalogSearchQuerySchema.parse(query);
        return this.transport.searchCatalog(parsed, signal);
    }
    async installFromCatalog(entry, request) {
        const parsedSpec = (0, skill_catalog_contract_1.parseGitHubSkillSpec)(entry.repository);
        if (!parsedSpec) {
            throw new Error(`skill-install-source-invalid: ${entry.repository}`);
        }
        const spec = {
            ...parsedSpec,
            ...(entry.ref ? { ref: entry.ref } : {}),
            ...(entry.subpath ? { subpath: entry.subpath } : {}),
            skillId: inferSkillId(entry.id)
        };
        return this.installFromGitHub(spec, request, {
            author: entry.author,
            tags: entry.tags
        });
    }
    async installFromGitHub(rawSpec, request, metadata) {
        assertNotAborted(request.signal);
        const spec = typeof rawSpec === 'string'
            ? (0, skill_catalog_contract_1.parseGitHubSkillSpec)(rawSpec)
            : skill_catalog_contract_1.GitHubInstallSpecSchema.parse(rawSpec);
        if (!spec) {
            throw new Error('skill-install-source-invalid');
        }
        const fetched = await this.transport.fetchGitHubSkillFiles(spec, request.signal);
        assertNotAborted(request.signal);
        const fallbackName = spec.subpath?.split('/').filter(Boolean).at(-1) ?? spec.repo;
        const skillId = inferSkillId(spec.skillId ?? fetched.resolvedSkillId ?? fallbackName);
        return this.stageAndCommitToVault({
            skillId,
            files: fetched.files,
            request,
            author: metadata?.author ?? fetched.author ?? spec.owner,
            tags: metadata?.tags ?? []
        });
    }
    async stageAndCommitToVault(input) {
        const { skillId, files, request } = input;
        const semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)();
        const vaultPath = (0, skill_vault_paths_1.skillVaultEntryRoot)(request.vaultRoot, skillId);
        await (0, readonly_root_fence_1.assertWritableSkillTarget)(vaultPath, {
            readonlyRoots: request.readonlyRoots,
            semantics
        });
        const existing = await (0, promises_1.stat)(vaultPath).catch(() => null);
        if (existing && !request.overwrite) {
            throw new Error(`skill-install-conflict: ${skillId}`);
        }
        await (0, promises_1.mkdir)(request.vaultRoot, { recursive: true });
        const stagePath = (0, node_path_1.join)(request.vaultRoot, `.${skillId}${staging_marker_1.SKILL_VAULT_STAGE_MARKER}${(0, node_crypto_1.randomUUID)()}`);
        let backupPath = null;
        try {
            await (0, promises_1.mkdir)(stagePath, { recursive: true });
            let hasSkillMarkdown = false;
            for (const file of files) {
                assertNotAborted(request.signal);
                const target = safeStageRelativePath(stagePath, file.relativePath);
                if (file.relativePath.replace(/\\/g, '/') === 'SKILL.md') {
                    hasSkillMarkdown = true;
                }
                await (0, promises_1.mkdir)((0, node_path_1.dirname)(target), { recursive: true });
                await (0, promises_1.writeFile)(target, file.content);
                if (file.executable && process.platform !== 'win32') {
                    await (0, promises_1.chmod)(target, 0o755);
                }
            }
            if (!hasSkillMarkdown) {
                throw new Error(`skill-package-missing-skill-md: ${skillId}`);
            }
            await (0, skill_package_identity_1.checkSkillPackageShape)(stagePath);
            const observed = await (0, skill_package_identity_1.observeSkillPackage)(stagePath);
            const markdown = await (0, promises_1.readFile)((0, node_path_1.join)(stagePath, 'SKILL.md'), 'utf8');
            const summary = (0, skill_metadata_1.summarizeSkillMarkdown)(markdown);
            const sizeBytes = observed.files.reduce((sum, file) => sum + file.size, 0);
            assertNotAborted(request.signal);
            if (existing) {
                backupPath = (0, node_path_1.join)(request.vaultRoot, `.${skillId}${staging_marker_1.SKILL_VAULT_STAGE_MARKER}bak-${(0, node_crypto_1.randomUUID)()}`);
                await (0, skill_filesystem_retry_1.renameSkillPathWithWindowsRetry)(vaultPath, backupPath);
            }
            await (0, skill_filesystem_retry_1.renameSkillPathWithWindowsRetry)(stagePath, vaultPath);
            if (backupPath) {
                await (0, promises_1.rm)(backupPath, { recursive: true, force: true }).catch(() => undefined);
                backupPath = null;
            }
            const previousIndex = await (0, skill_vault_index_service_1.readSkillVaultIndex)(request.indexPath);
            const previousEntry = previousIndex?.entries.find((item) => item.id === skillId);
            const now = new Date().toISOString();
            const entry = {
                id: skillId,
                name: summary.name ?? skillId,
                description: summary.description,
                sourceKind: 'installed',
                originPath: previousEntry?.originPath ?? null,
                linkPaths: previousEntry?.linkPaths ?? [],
                digest: observed.observedDigest,
                sizeBytes,
                tags: [...new Set([...(previousEntry?.tags ?? []), ...input.tags])].slice(0, 64),
                author: input.author ?? previousEntry?.author ?? null,
                installedAt: previousEntry?.installedAt ?? now,
                updatedAt: now
            };
            const nextEntries = [
                ...(previousIndex?.entries ?? []).filter((item) => item.id !== skillId),
                entry
            ];
            const index = await (0, skill_vault_index_service_1.rebuildSkillVaultIndex)(request.indexPath, nextEntries);
            return {
                id: skillId,
                vaultPath,
                digest: observed.observedDigest,
                sizeBytes,
                entry,
                index
            };
        }
        catch (error) {
            if (backupPath) {
                await (0, skill_filesystem_retry_1.renameSkillPathWithWindowsRetry)(backupPath, vaultPath).catch(() => undefined);
            }
            await (0, promises_1.rm)(stagePath, { recursive: true, force: true }).catch(() => undefined);
            throw error;
        }
    }
}
exports.SkillCatalogService = SkillCatalogService;
