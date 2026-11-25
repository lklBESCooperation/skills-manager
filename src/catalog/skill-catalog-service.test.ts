import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseGitHubSkillSpec,
  type CatalogTransportPort
} from '../contracts/skill-catalog-contract'
import { SkillCatalogService } from './skill-catalog-service'
import { readSkillVaultIndex } from '../vault/skill-vault-index-service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function mockTransport(files: { relativePath: string; content: string }[]): CatalogTransportPort {
  return {
    fetchLeaderboard: async () => ({
      entries: [
        {
          id: 'code-review',
          name: 'Code Review',
          description: 'Review PRs',
          author: 'acme',
          tags: ['git'],
          repository: 'https://github.com/acme/code-review',
          downloads: 1200,
          rank: 1,
          verified: true
        }
      ],
      total: 1,
      hasMore: false
    }),
    searchCatalog: async (query) => ({
      entries: query.query.includes('review')
        ? [
            {
              id: 'code-review',
              name: 'Code Review',
              description: 'Review PRs',
              author: 'acme',
              tags: ['git'],
              repository: 'https://github.com/acme/code-review'
            }
          ]
        : [],
      total: query.query.includes('review') ? 1 : 0,
      hasMore: false
    }),
    fetchGitHubSkillFiles: async () => ({
      files,
      resolvedSkillId: 'code-review',
      author: 'acme'
    })
  }
}

describe('SkillCatalogService & parseGitHubSkillSpec', () => {
  it('parses owner/repo and tree URLs while rejecting unsafe specs', () => {
    expect(parseGitHubSkillSpec('acme/skills')).toEqual({ owner: 'acme', repo: 'skills' })
    expect(
      parseGitHubSkillSpec('https://github.com/acme/skills/tree/main/packages/review')
    ).toEqual({
      owner: 'acme',
      repo: 'skills',
      ref: 'main',
      subpath: 'packages/review'
    })
    expect(parseGitHubSkillSpec('https://evil.example.com/acme/skills')).toBeNull()
    expect(parseGitHubSkillSpec('https://github.com/acme/skills/tree/main/../escape')).toBeNull()
  })

  it('installs from GitHub via atomic staging into Vault and updates index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-catalog-'))
    roots.push(root)
    const vaultRoot = join(root, '.pmstudio', 'skills')
    const indexPath = join(root, '.pmstudio', 'skills-index.json')

    const service = new SkillCatalogService(
      mockTransport([
        {
          relativePath: 'SKILL.md',
          content: '---\nname: Code Review\ndescription: Review diffs\n---\n# Code Review\n'
        },
        {
          relativePath: 'prompts/check.md',
          content: 'Check edge cases.\n'
        }
      ])
    )

    const board = await service.leaderboard()
    expect(board.entries).toHaveLength(1)
    const search = await service.search({ query: 'review' })
    expect(search.entries).toHaveLength(1)

    const outcome = await service.installFromCatalog(board.entries[0]!, {
      vaultRoot,
      indexPath
    })
    expect(outcome.id).toBe('code-review')
    expect(await readFile(join(vaultRoot, 'code-review', 'prompts', 'check.md'), 'utf8')).toBe(
      'Check edge cases.\n'
    )
    const index = await readSkillVaultIndex(indexPath)
    expect(index?.entries.find((e) => e.id === 'code-review')?.sourceKind).toBe('installed')
    expect(await readdir(vaultRoot)).toEqual(['code-review'])
  })

  it('rejects path traversal and cleans staging directories on failure or abort', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-catalog-err-'))
    roots.push(root)
    const vaultRoot = join(root, '.pmstudio', 'skills')
    const indexPath = join(root, '.pmstudio', 'skills-index.json')
    await mkdir(vaultRoot, { recursive: true })

    const traversalService = new SkillCatalogService(
      mockTransport([
        { relativePath: 'SKILL.md', content: '---\nname: x\ndescription: x\n---\n' },
        { relativePath: '../../escape.txt', content: 'boom' }
      ])
    )
    await expect(
      traversalService.installFromGitHub('acme/evil', { vaultRoot, indexPath })
    ).rejects.toThrow('skill-path-escape')
    expect(await readdir(vaultRoot)).toEqual([])

    const missingMdService = new SkillCatalogService(
      mockTransport([{ relativePath: 'README.md', content: 'no skill md' }])
    )
    await expect(
      missingMdService.installFromGitHub('acme/empty', { vaultRoot, indexPath })
    ).rejects.toThrow('skill-package-missing-skill-md')
    expect(await readdir(vaultRoot)).toEqual([])

    const abortedService = new SkillCatalogService(
      mockTransport([{ relativePath: 'SKILL.md', content: '---\nname: x\ndescription: x\n---\n' }])
    )
    await expect(
      abortedService.installFromGitHub('acme/aborted', {
        vaultRoot,
        indexPath,
        signal: { aborted: true }
      })
    ).rejects.toThrow('skill-install-cancelled')
  })
})
