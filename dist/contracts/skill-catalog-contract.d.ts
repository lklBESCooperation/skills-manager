import { z } from 'zod';
import type { TuiAgent } from './tui-agent';
export type CatalogAbortSignal = {
    readonly aborted: boolean;
};
export declare const CatalogSkillEntrySchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    author: z.ZodNullable<z.ZodString>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    version: z.ZodOptional<z.ZodString>;
    downloads: z.ZodOptional<z.ZodNumber>;
    rank: z.ZodOptional<z.ZodNumber>;
    verified: z.ZodOptional<z.ZodBoolean>;
    repository: z.ZodString;
    ref: z.ZodOptional<z.ZodString>;
    subpath: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type CatalogSkillEntry = z.infer<typeof CatalogSkillEntrySchema>;
export declare const CatalogLeaderboardQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodNumber>;
    offset: z.ZodDefault<z.ZodNumber>;
    tag: z.ZodOptional<z.ZodString>;
    period: z.ZodDefault<z.ZodEnum<{
        all: "all";
        monthly: "monthly";
        weekly: "weekly";
    }>>;
}, z.core.$strict>;
export type CatalogLeaderboardQuery = z.input<typeof CatalogLeaderboardQuerySchema>;
export declare const CatalogSearchQuerySchema: z.ZodObject<{
    query: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
    offset: z.ZodDefault<z.ZodNumber>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export type CatalogSearchQuery = z.input<typeof CatalogSearchQuerySchema>;
export type CatalogPageResult = {
    entries: CatalogSkillEntry[];
    total: number;
    hasMore: boolean;
};
export declare const GitHubInstallSpecSchema: z.ZodObject<{
    owner: z.ZodString;
    repo: z.ZodString;
    ref: z.ZodOptional<z.ZodString>;
    subpath: z.ZodOptional<z.ZodString>;
    skillId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type GitHubInstallSpec = z.infer<typeof GitHubInstallSpecSchema>;
export type CatalogInstallRequest = {
    vaultRoot: string;
    indexPath: string;
    targetAgents?: readonly TuiAgent[];
    overwrite?: boolean;
    readonlyRoots?: readonly string[];
    signal?: CatalogAbortSignal;
};
export type CatalogDownloadedFile = {
    relativePath: string;
    content: Uint8Array | string;
    executable?: boolean;
};
export type CatalogTransportPort = {
    fetchLeaderboard(query: Required<Pick<CatalogLeaderboardQuery, 'limit' | 'offset' | 'period'>> & {
        tag?: string;
    }, signal?: CatalogAbortSignal): Promise<CatalogPageResult>;
    searchCatalog(query: Required<Pick<CatalogSearchQuery, 'query' | 'limit' | 'offset'>> & {
        tags?: string[];
    }, signal?: CatalogAbortSignal): Promise<CatalogPageResult>;
    fetchGitHubSkillFiles(spec: GitHubInstallSpec, signal?: CatalogAbortSignal): Promise<{
        files: CatalogDownloadedFile[];
        resolvedSkillId?: string;
        author?: string;
    }>;
};
/**
 * Parses `owner/repo`, `https://github.com/owner/repo`, or
 * `https://github.com/owner/repo/tree/<ref>/<subpath>` into a validated spec.
 */
export declare function parseGitHubSkillSpec(rawInput: string): GitHubInstallSpec | null;
