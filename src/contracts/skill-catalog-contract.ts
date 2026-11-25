import { z } from 'zod'
import type { TuiAgent } from './tui-agent'

export type CatalogAbortSignal = {
  readonly aborted: boolean
}

export const CatalogSkillEntrySchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(256),
    description: z.string().nullable(),
    author: z.string().nullable(),
    tags: z.array(z.string().min(1).max(64)).default([]),
    version: z.string().min(1).optional(),
    downloads: z.number().int().nonnegative().optional(),
    rank: z.number().int().positive().optional(),
    verified: z.boolean().optional(),
    repository: z.string().min(1),
    ref: z.string().min(1).optional(),
    subpath: z.string().optional(),
    updatedAt: z.string().min(1).optional()
  })
  .strict()

export type CatalogSkillEntry = z.infer<typeof CatalogSkillEntrySchema>

export const CatalogLeaderboardQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().nonnegative().default(0),
    tag: z.string().min(1).optional(),
    period: z.enum(['all', 'weekly', 'monthly']).default('all')
  })
  .strict()

export type CatalogLeaderboardQuery = z.input<typeof CatalogLeaderboardQuerySchema>

export const CatalogSearchQuerySchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().nonnegative().default(0),
    tags: z.array(z.string().min(1)).optional()
  })
  .strict()

export type CatalogSearchQuery = z.input<typeof CatalogSearchQuerySchema>

export type CatalogPageResult = {
  entries: CatalogSkillEntry[]
  total: number
  hasMore: boolean
}

export const GitHubInstallSpecSchema = z
  .object({
    owner: z.string().regex(/^[A-Za-z0-9_.-]+$/),
    repo: z.string().regex(/^[A-Za-z0-9_.-]+$/),
    ref: z.string().min(1).optional(),
    subpath: z.string().min(1).optional(),
    skillId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional()
  })
  .strict()

export type GitHubInstallSpec = z.infer<typeof GitHubInstallSpecSchema>

export type CatalogInstallRequest = {
  vaultRoot: string
  indexPath: string
  targetAgents?: readonly TuiAgent[]
  overwrite?: boolean
  readonlyRoots?: readonly string[]
  signal?: CatalogAbortSignal
}

export type CatalogDownloadedFile = {
  relativePath: string
  content: Uint8Array | string
  executable?: boolean
}

export type CatalogTransportPort = {
  fetchLeaderboard(
    query: Required<Pick<CatalogLeaderboardQuery, 'limit' | 'offset' | 'period'>> & { tag?: string },
    signal?: CatalogAbortSignal
  ): Promise<CatalogPageResult>
  searchCatalog(
    query: Required<Pick<CatalogSearchQuery, 'query' | 'limit' | 'offset'>> & { tags?: string[] },
    signal?: CatalogAbortSignal
  ): Promise<CatalogPageResult>
  fetchGitHubSkillFiles(
    spec: GitHubInstallSpec,
    signal?: CatalogAbortSignal
  ): Promise<{ files: CatalogDownloadedFile[]; resolvedSkillId?: string; author?: string }>
}

const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/

/**
 * Parses `owner/repo`, `https://github.com/owner/repo`, or
 * `https://github.com/owner/repo/tree/<ref>/<subpath>` into a validated spec.
 */
export function parseGitHubSkillSpec(rawInput: string): GitHubInstallSpec | null {
  const trimmed = rawInput.trim().replace(/\.git$/i, '').replace(/\/+$/, '')
  if (!trimmed) {
    return null
  }

  let pathPart = trimmed
  const urlMatch = /^https?:\/\/([^/]+)(\/.*)?$/i.exec(trimmed)
  if (urlMatch) {
    const host = urlMatch[1].toLowerCase()
    if (host !== 'github.com') {
      return null
    }
    pathPart = (urlMatch[2] ?? '').replace(/^\/+|\/+$/g, '')
  } else if (trimmed.includes('://')) {
    return null
  }

  const cleanPath = pathPart.split(/[?#]/, 1)[0]
  const segments = cleanPath.split('/').filter(Boolean)
  if (segments.length < 2) {
    return null
  }
  const [owner, repo, mode, ref, ...rest] = segments
  if (!SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(repo) || owner === '..' || repo === '..') {
    return null
  }
  if (segments.length === 2) {
    return { owner, repo }
  }
  if (mode === 'tree' && ref && SAFE_SEGMENT.test(ref) && ref !== '..') {
    const subpath = rest.length > 0 ? rest.join('/') : undefined
    if (subpath && subpath.split('/').some((seg) => seg === '..' || seg === '.')) {
      return null
    }
    return {
      owner,
      repo,
      ref,
      ...(subpath ? { subpath } : {})
    }
  }
  return null
}
