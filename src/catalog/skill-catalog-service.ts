import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  CatalogLeaderboardQuerySchema,
  CatalogSearchQuerySchema,
  GitHubInstallSpecSchema,
  parseGitHubSkillSpec,
  type CatalogDownloadedFile,
  type CatalogInstallRequest,
  type CatalogLeaderboardQuery,
  type CatalogPageResult,
  type CatalogSearchQuery,
  type CatalogSkillEntry,
  type CatalogTransportPort,
  type GitHubInstallSpec
} from '../contracts/skill-catalog-contract'
import { validateSkillId } from '../contracts/skill-editor-contract'
import { summarizeSkillMarkdown } from '../contracts/skill-metadata'
import { nativeSkillPathSemantics, skillPathInside } from '../contracts/skill-path-containment'
import type { SkillVaultEntry, SkillVaultIndex } from '../contracts/skill-vault-contract'
import { assertWritableSkillTarget } from '../infra/readonly-root-fence'
import { renameSkillPathWithWindowsRetry } from '../infra/skill-filesystem-retry'
import { checkSkillPackageShape, observeSkillPackage } from '../infra/skill-package-identity'
import {
  readSkillVaultIndex,
  rebuildSkillVaultIndex
} from '../vault/skill-vault-index-service'
import { skillVaultEntryRoot } from '../vault/skill-vault-paths'
import { SKILL_VAULT_STAGE_MARKER } from '../vault/staging-marker'

export type CatalogInstallOutcome = {
  id: string
  vaultPath: string
  digest: string
  sizeBytes: number
  entry: SkillVaultEntry
  index: SkillVaultIndex
}

function assertNotAborted(signal?: { readonly aborted: boolean }): void {
  if (signal?.aborted) {
    throw new Error('skill-install-cancelled')
  }
}

function safeStageRelativePath(stageRoot: string, relativePath: string): string {
  const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleaned || cleaned.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
    throw new Error(`skill-path-escape: ${relativePath}`)
  }
  const target = resolve(stageRoot, cleaned)
  if (!skillPathInside(stageRoot, target, nativeSkillPathSemantics())) {
    throw new Error(`skill-path-escape: ${relativePath}`)
  }
  return target
}

function inferSkillId(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!validateSkillId(normalized)) {
    throw new Error(`skill-install-name-invalid: ${raw}`)
  }
  return normalized
}

export class SkillCatalogService {
  constructor(private readonly transport: CatalogTransportPort) {}

  async leaderboard(
    query: CatalogLeaderboardQuery = {},
    signal?: { readonly aborted: boolean }
  ): Promise<CatalogPageResult> {
    const parsed = CatalogLeaderboardQuerySchema.parse(query)
    return this.transport.fetchLeaderboard(parsed, signal)
  }

  async search(
    query: CatalogSearchQuery,
    signal?: { readonly aborted: boolean }
  ): Promise<CatalogPageResult> {
    const parsed = CatalogSearchQuerySchema.parse(query)
    return this.transport.searchCatalog(parsed, signal)
  }

  async installFromCatalog(
    entry: CatalogSkillEntry,
    request: CatalogInstallRequest
  ): Promise<CatalogInstallOutcome> {
    const parsedSpec = parseGitHubSkillSpec(entry.repository)
    if (!parsedSpec) {
      throw new Error(`skill-install-source-invalid: ${entry.repository}`)
    }
    const spec: GitHubInstallSpec = {
      ...parsedSpec,
      ...(entry.ref ? { ref: entry.ref } : {}),
      ...(entry.subpath ? { subpath: entry.subpath } : {}),
      skillId: inferSkillId(entry.id)
    }
    return this.installFromGitHub(spec, request, {
      author: entry.author,
      tags: entry.tags
    })
  }

  async installFromGitHub(
    rawSpec: string | GitHubInstallSpec,
    request: CatalogInstallRequest,
    metadata?: { author?: string | null; tags?: readonly string[] }
  ): Promise<CatalogInstallOutcome> {
    assertNotAborted(request.signal)
    const spec =
      typeof rawSpec === 'string'
        ? parseGitHubSkillSpec(rawSpec)
        : GitHubInstallSpecSchema.parse(rawSpec)
    if (!spec) {
      throw new Error('skill-install-source-invalid')
    }

    const fetched = await this.transport.fetchGitHubSkillFiles(spec, request.signal)
    assertNotAborted(request.signal)

    const fallbackName = spec.subpath?.split('/').filter(Boolean).at(-1) ?? spec.repo
    const skillId = inferSkillId(spec.skillId ?? fetched.resolvedSkillId ?? fallbackName)
    return this.stageAndCommitToVault({
      skillId,
      files: fetched.files,
      request,
      author: metadata?.author ?? fetched.author ?? spec.owner,
      tags: metadata?.tags ?? []
    })
  }

  private async stageAndCommitToVault(input: {
    skillId: string
    files: readonly CatalogDownloadedFile[]
    request: CatalogInstallRequest
    author: string | null
    tags: readonly string[]
  }): Promise<CatalogInstallOutcome> {
    const { skillId, files, request } = input
    const semantics = nativeSkillPathSemantics()
    const vaultPath = skillVaultEntryRoot(request.vaultRoot, skillId)
    await assertWritableSkillTarget(vaultPath, {
      readonlyRoots: request.readonlyRoots,
      semantics
    })

    const existing = await stat(vaultPath).catch(() => null)
    if (existing && !request.overwrite) {
      throw new Error(`skill-install-conflict: ${skillId}`)
    }

    await mkdir(request.vaultRoot, { recursive: true })
    const stagePath = join(
      request.vaultRoot,
      `.${skillId}${SKILL_VAULT_STAGE_MARKER}${randomUUID()}`
    )
    let backupPath: string | null = null

    try {
      await mkdir(stagePath, { recursive: true })
      let hasSkillMarkdown = false
      for (const file of files) {
        assertNotAborted(request.signal)
        const target = safeStageRelativePath(stagePath, file.relativePath)
        if (file.relativePath.replace(/\\/g, '/') === 'SKILL.md') {
          hasSkillMarkdown = true
        }
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, file.content)
        if (file.executable && process.platform !== 'win32') {
          await chmod(target, 0o755)
        }
      }
      if (!hasSkillMarkdown) {
        throw new Error(`skill-package-missing-skill-md: ${skillId}`)
      }

      await checkSkillPackageShape(stagePath)
      const observed = await observeSkillPackage(stagePath)
      const markdown = await readFile(join(stagePath, 'SKILL.md'), 'utf8')
      const summary = summarizeSkillMarkdown(markdown)
      const sizeBytes = observed.files.reduce((sum, file) => sum + file.size, 0)

      assertNotAborted(request.signal)

      if (existing) {
        backupPath = join(
          request.vaultRoot,
          `.${skillId}${SKILL_VAULT_STAGE_MARKER}bak-${randomUUID()}`
        )
        await renameSkillPathWithWindowsRetry(vaultPath, backupPath)
      }

      await renameSkillPathWithWindowsRetry(stagePath, vaultPath)
      if (backupPath) {
        await rm(backupPath, { recursive: true, force: true }).catch(() => undefined)
        backupPath = null
      }

      const previousIndex = await readSkillVaultIndex(request.indexPath)
      const previousEntry = previousIndex?.entries.find((item) => item.id === skillId)
      const now = new Date().toISOString()
      const entry: SkillVaultEntry = {
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
      }
      const nextEntries = [
        ...(previousIndex?.entries ?? []).filter((item) => item.id !== skillId),
        entry
      ]
      const index = await rebuildSkillVaultIndex(request.indexPath, nextEntries)
      return {
        id: skillId,
        vaultPath,
        digest: observed.observedDigest,
        sizeBytes,
        entry,
        index
      }
    } catch (error) {
      if (backupPath) {
        await renameSkillPathWithWindowsRetry(backupPath, vaultPath).catch(() => undefined)
      }
      await rm(stagePath, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }
}
