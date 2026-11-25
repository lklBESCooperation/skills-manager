"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubInstallSpecSchema = exports.CatalogSearchQuerySchema = exports.CatalogLeaderboardQuerySchema = exports.CatalogSkillEntrySchema = void 0;
exports.parseGitHubSkillSpec = parseGitHubSkillSpec;
const zod_1 = require("zod");
exports.CatalogSkillEntrySchema = zod_1.z
    .object({
    id: zod_1.z.string().min(1).max(128),
    name: zod_1.z.string().min(1).max(256),
    description: zod_1.z.string().nullable(),
    author: zod_1.z.string().nullable(),
    tags: zod_1.z.array(zod_1.z.string().min(1).max(64)).default([]),
    version: zod_1.z.string().min(1).optional(),
    downloads: zod_1.z.number().int().nonnegative().optional(),
    rank: zod_1.z.number().int().positive().optional(),
    verified: zod_1.z.boolean().optional(),
    repository: zod_1.z.string().min(1),
    ref: zod_1.z.string().min(1).optional(),
    subpath: zod_1.z.string().optional(),
    updatedAt: zod_1.z.string().min(1).optional()
})
    .strict();
exports.CatalogLeaderboardQuerySchema = zod_1.z
    .object({
    limit: zod_1.z.number().int().min(1).max(100).default(20),
    offset: zod_1.z.number().int().nonnegative().default(0),
    tag: zod_1.z.string().min(1).optional(),
    period: zod_1.z.enum(['all', 'weekly', 'monthly']).default('all')
})
    .strict();
exports.CatalogSearchQuerySchema = zod_1.z
    .object({
    query: zod_1.z.string().trim().min(1).max(200),
    limit: zod_1.z.number().int().min(1).max(100).default(20),
    offset: zod_1.z.number().int().nonnegative().default(0),
    tags: zod_1.z.array(zod_1.z.string().min(1)).optional()
})
    .strict();
exports.GitHubInstallSpecSchema = zod_1.z
    .object({
    owner: zod_1.z.string().regex(/^[A-Za-z0-9_.-]+$/),
    repo: zod_1.z.string().regex(/^[A-Za-z0-9_.-]+$/),
    ref: zod_1.z.string().min(1).optional(),
    subpath: zod_1.z.string().min(1).optional(),
    skillId: zod_1.z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional()
})
    .strict();
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;
/**
 * Parses `owner/repo`, `https://github.com/owner/repo`, or
 * `https://github.com/owner/repo/tree/<ref>/<subpath>` into a validated spec.
 */
function parseGitHubSkillSpec(rawInput) {
    const trimmed = rawInput.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
    if (!trimmed) {
        return null;
    }
    let pathPart = trimmed;
    const urlMatch = /^https?:\/\/([^/]+)(\/.*)?$/i.exec(trimmed);
    if (urlMatch) {
        const host = urlMatch[1].toLowerCase();
        if (host !== 'github.com') {
            return null;
        }
        pathPart = (urlMatch[2] ?? '').replace(/^\/+|\/+$/g, '');
    }
    else if (trimmed.includes('://')) {
        return null;
    }
    const cleanPath = pathPart.split(/[?#]/, 1)[0];
    const segments = cleanPath.split('/').filter(Boolean);
    if (segments.length < 2) {
        return null;
    }
    const [owner, repo, mode, ref, ...rest] = segments;
    if (!SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(repo) || owner === '..' || repo === '..') {
        return null;
    }
    if (segments.length === 2) {
        return { owner, repo };
    }
    if (mode === 'tree' && ref && SAFE_SEGMENT.test(ref) && ref !== '..') {
        const subpath = rest.length > 0 ? rest.join('/') : undefined;
        if (subpath && subpath.split('/').some((seg) => seg === '..' || seg === '.')) {
            return null;
        }
        return {
            owner,
            repo,
            ref,
            ...(subpath ? { subpath } : {})
        };
    }
    return null;
}
