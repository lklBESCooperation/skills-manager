import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, lstat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adoptSkillsIntoVault,
  nativeSkillVaultAdoptFilesystem,
  unadoptSkillFromVault,
  type SkillVaultAdoptFilesystem
} from './skill-vault-adopt'
import {
  readSkillVaultIndex,
  computeSkillVaultDigest,
  detectSkillVaultCopyMode
} from './skill-vault-index-service'
import { userSkillVaultIndexPath, userSkillVaultRoot } from './skill-vault-paths'

const roots: string[] = []

let home: string
let vaultRoot: string
let indexPath: string
let claudeSkills: string
let codexSkills: string

async function makeHome(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'orca-skill-vault-adopt-'))
  roots.push(root)
  home = join(root, 'home')
  vaultRoot = userSkillVaultRoot(home)
  indexPath = userSkillVaultIndexPath(home)
  claudeSkills = join(home, '.claude', 'skills')
  codexSkills = join(home, '.codex', 'skills')
  await mkdir(claudeSkills, { recursive: true })
  await mkdir(codexSkills, { recursive: true })
}

async function writeSkill(
  directory: string,
  name: string,
  body = `Body for ${name}.\n`
): Promise<string> {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\n---\n\n${body}`)
  return directory
}

beforeEach(makeHome)

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function treeSnapshot(directory: string): Promise<string> {
  return computeSkillVaultDigest(directory)
}

describe('adoptSkillsIntoVault', () => {
  it('moves the primary into the vault and links both origins (T1.9)', async () => {
    const claudeCopy = await writeSkill(join(claudeSkills, 'review'), 'review')
    const codexCopy = await writeSkill(join(codexSkills, 'planning'), 'planning')
    const claudeDigest = await treeSnapshot(claudeCopy)
    const codexDigest = await treeSnapshot(codexCopy)

    const outcome = await adoptSkillsIntoVault({
      homeDirectory: home,
      vaultRoot,
      indexPath,
      items: [
        { id: 'review', originPath: claudeCopy, mergePaths: [] },
        { id: 'planning', originPath: codexCopy, mergePaths: [] }
      ]
    })

    expect(outcome.copyMode).toBe(false)
    // Vault now owns both primaries.
    expect(await readFile(join(vaultRoot, 'review', 'SKILL.md'), 'utf8')).toContain('review')
    expect(await readFile(join(vaultRoot, 'planning', 'SKILL.md'), 'utf8')).toContain('planning')
    // Origins are links pointing at the vault copies.
    expect((await lstat(claudeCopy)).isSymbolicLink()).toBe(true)
    expect((await lstat(codexCopy)).isSymbolicLink()).toBe(true)
    expect(await realpath(claudeCopy)).toBe(await realpath(join(vaultRoot, 'review')))
    // Agent-visible content is byte-identical before and after (digest match).
    expect(await treeSnapshot(claudeCopy)).toBe(claudeDigest)
    expect(await treeSnapshot(codexCopy)).toBe(codexDigest)
    // Index records both adoptions with their origin paths.
    const index = await readSkillVaultIndex(indexPath)
    expect(index?.entries.map((entry) => entry.id).sort()).toEqual(['planning', 'review'])
    expect(index?.entries.find((entry) => entry.id === 'review')?.originPath).toBe(claudeCopy)
  })

  it('turns a same-digest second copy into a link during adopt (T1.9 merge)', async () => {
    const primary = await writeSkill(join(claudeSkills, 'shared'), 'shared')
    // Same bytes at a second root: identical tree digest by construction.
    const duplicate = await writeSkill(join(codexSkills, 'shared'), 'shared')
    expect(await treeSnapshot(duplicate)).toBe(await treeSnapshot(primary))
    const digestBefore = await treeSnapshot(primary)

    const outcome = await adoptSkillsIntoVault({
      homeDirectory: home,
      vaultRoot,
      indexPath,
      items: [{ id: 'shared', originPath: primary, mergePaths: [duplicate] }]
    })

    expect(outcome.adopted[0]?.merged).toEqual([duplicate])
    expect((await lstat(duplicate)).isSymbolicLink()).toBe(true)
    expect(await treeSnapshot(duplicate)).toBe(digestBefore)
  })

  it('rolls the first item back when the second item fails (T1.10)', async () => {
    const first = await writeSkill(join(claudeSkills, 'review'), 'review', 'first body\n')
    const second = await writeSkill(join(codexSkills, 'planning'), 'planning', 'second body\n')
    const firstBytes = await readFile(join(first, 'SKILL.md'), 'utf8')
    const secondBytes = await readFile(join(second, 'SKILL.md'), 'utf8')

    // Fail the second item's mkdir (link creation prepares its origin parent).
    const failingFilesystem: SkillVaultAdoptFilesystem = {
      ...nativeSkillVaultAdoptFilesystem,
      mkdir: async (path) => {
        if (path === codexSkills) {
          throw new Error('injected mkdir failure')
        }
        await nativeSkillVaultAdoptFilesystem.mkdir(path)
      }
    }

    await expect(
      adoptSkillsIntoVault({
        homeDirectory: home,
        vaultRoot,
        indexPath,
        items: [
          { id: 'review', originPath: first, mergePaths: [] },
          { id: 'planning', originPath: second, mergePaths: [] }
        ],
        filesystem: failingFilesystem
      })
    ).rejects.toThrow('injected mkdir failure')

    // Both sites are back to their pre-run bytes with no links or vault entries.
    expect(await readFile(join(first, 'SKILL.md'), 'utf8')).toBe(firstBytes)
    expect(await readFile(join(second, 'SKILL.md'), 'utf8')).toBe(secondBytes)
    expect((await lstat(first)).isSymbolicLink()).toBe(false)
    expect((await lstat(second)).isSymbolicLink()).toBe(false)
    expect(await readdir(vaultRoot).catch(() => [])).toEqual([])
    expect(await readSkillVaultIndex(indexPath)).toBeNull()
  })

  it('falls back to copies and marks the index copyMode when symlinks fail (T1.12)', async () => {
    const origin = await writeSkill(join(claudeSkills, 'review'), 'review')
    const digestBefore = await treeSnapshot(origin)

    const noSymlinkFilesystem: SkillVaultAdoptFilesystem = {
      ...nativeSkillVaultAdoptFilesystem,
      symlink: async () => {
        throw new Error('EPERM')
      }
    }
    // Force the copy-mode probe down its degradation path.
    const probeSpy = vi
      .spyOn(await import('./skill-vault-index-service.js'), 'detectSkillVaultCopyMode')
      .mockResolvedValue(true)

    const outcome = await adoptSkillsIntoVault({
      homeDirectory: home,
      vaultRoot,
      indexPath,
      items: [{ id: 'review', originPath: origin, mergePaths: [] }],
      filesystem: noSymlinkFilesystem
    })

    expect(probeSpy).toHaveBeenCalled()
    expect(outcome.copyMode).toBe(true)
    expect((await lstat(origin)).isSymbolicLink()).toBe(false)
    expect(await readFile(join(origin, 'SKILL.md'), 'utf8')).toContain('review')
    expect(await treeSnapshot(origin)).toBe(digestBefore)
    const index = await readSkillVaultIndex(indexPath)
    expect(index?.entries.find((entry) => entry.id === 'review')?.copyMode).toBe(true)
  })

  it('restores the primary and removes the link on unadopt (T1.11)', async () => {
    const origin = await writeSkill(join(claudeSkills, 'review'), 'review', 'unique body\n')
    const digestBefore = await treeSnapshot(origin)
    await adoptSkillsIntoVault({
      homeDirectory: home,
      vaultRoot,
      indexPath,
      items: [{ id: 'review', originPath: origin, mergePaths: [] }]
    })

    const result = await unadoptSkillFromVault({ vaultRoot, indexPath, id: 'review' })

    expect(result.originPath).toBe(origin)
    // Byte-level identity at the original location; no link, no vault copy.
    expect((await lstat(origin)).isSymbolicLink()).toBe(false)
    expect(await treeSnapshot(origin)).toBe(digestBefore)
    expect(await readdir(vaultRoot)).toEqual([])
    const index = await readSkillVaultIndex(indexPath)
    expect(index?.entries ?? []).toEqual([])
  })

  it('refuses to unadopt an unknown id', async () => {
    await expect(unadoptSkillFromVault({ vaultRoot, indexPath, id: 'missing' })).rejects.toThrow(
      'skill-vault-unknown-entry'
    )
  })
})

describe('detectSkillVaultCopyMode', () => {
  it('reports symlink support on a capable host', async () => {
    // On platforms without symlink privilege this asserts the degradation, not a bug.
    const unsupportedWithoutPrivilege = process.platform === 'win32'
    expect(await detectSkillVaultCopyMode(vaultRoot)).toBe(unsupportedWithoutPrivilege)
  })
})
