import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyCopyModePlacement } from '../contracts/skill-vault-contract'
import { runSkillEnablementCommand } from '../enablement/skill-enablement-applier'
import { fixtureSkillEnablementFileIO } from '../enablement/skill-enablement-file-io.test-fixture'
import {
  adoptSkillsIntoVault,
  nativeSkillVaultAdoptFilesystem,
  promoteCopyModeToVault,
  resetCopyModeFromVault,
  unadoptSkillFromVault,
  type SkillVaultAdoptFilesystem
} from './skill-vault-adopt'
import { readSkillVaultIndex } from './skill-vault-index-service'
import { userSkillVaultIndexPath, userSkillVaultRoot } from './skill-vault-paths'
import { scanSkillVault } from './skill-vault-scan'

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Windows copyMode drift protection & bidirectional sync', () => {
  it('classifies clean, outdated, drifted, and foreign copyMode states', () => {
    const v = 'a'.repeat(64)
    const other = 'b'.repeat(64)
    expect(
      classifyCopyModePlacement({
        vaultDigest: v,
        observedDigest: v,
        placement: { topology: 'copy', syncedDigest: v }
      })
    ).toBe('managed-copy-clean')

    expect(
      classifyCopyModePlacement({
        vaultDigest: other,
        observedDigest: v,
        placement: { topology: 'copy', syncedDigest: v }
      })
    ).toBe('managed-copy-outdated')

    expect(
      classifyCopyModePlacement({
        vaultDigest: v,
        observedDigest: other,
        placement: { topology: 'copy', syncedDigest: v }
      })
    ).toBe('managed-copy-drifted')

    expect(
      classifyCopyModePlacement({
        vaultDigest: v,
        observedDigest: v,
        placement: undefined
      })
    ).toBe('foreign-conflict')
  })

  it('protects drifted copyMode edits on disable/unadopt and supports promote & reset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-copymode-'))
    roots.push(root)
    const home = join(root, 'home')
    const vaultRoot = userSkillVaultRoot(home)
    const indexPath = userSkillVaultIndexPath(home)
    const claudeCopy = join(home, '.claude', 'skills', 'review')
    await mkdir(claudeCopy, { recursive: true })
    await writeFile(join(claudeCopy, 'SKILL.md'), '---\nname: review\ndescription: v1\n---\nv1\n')

    vi.spyOn(
      await import('./skill-vault-index-service.js'),
      'detectSkillVaultCopyMode'
    ).mockResolvedValue(true)

    const noSymlinkFs: SkillVaultAdoptFilesystem = {
      ...nativeSkillVaultAdoptFilesystem,
      symlink: async () => {
        throw new Error('EPERM')
      }
    }

    const adopted = await adoptSkillsIntoVault({
      homeDirectory: home,
      vaultRoot,
      indexPath,
      items: [{ id: 'review', originPath: claudeCopy, mergePaths: [] }],
      filesystem: noSymlinkFs
    })
    expect(adopted.copyMode).toBe(true)

    // User edits the copyMode placement locally -> drifted!
    await writeFile(
      join(claudeCopy, 'SKILL.md'),
      '---\nname: review\ndescription: v1\n---\nhand-edited\n'
    )

    const scanDrifted = await scanSkillVault({
      homeDirectory: home,
      vaultRoot,
      candidatePaths: [claudeCopy],
      index: await readSkillVaultIndex(indexPath)
    })
    expect(scanDrifted.counts.copyDrifted).toBe(1)
    expect(scanDrifted.items[0]?.disposition).toBe('copy-drifted')

    // Disable must NOT delete the drifted local copy.
    const disableRes = await runSkillEnablementCommand({
      command: { kind: 'disable', skillIds: ['review'], scope: 'user' },
      runtime: {
        scope: 'global',
        homeDirectory: home,
        vaultRoot,
        indexPath,
        stateDirectory: join(home, '.pmstudio', 'state'),
        detectedProviders: ['claude'],
        copyMode: true,
        fileIO: fixtureSkillEnablementFileIO()
      }
    })
    expect(disableRes.conflicts).toHaveLength(1)
    expect(await readFile(join(claudeCopy, 'SKILL.md'), 'utf8')).toContain('hand-edited')

    // Unadopt without force also refuses to clobber drifted copy.
    await expect(
      unadoptSkillFromVault({ vaultRoot, indexPath, id: 'review' })
    ).rejects.toThrow('skill-copy-mode-drifted')

    // Promote updates Vault master & syncedDigest.
    const promotedIndex = await promoteCopyModeToVault({
      vaultRoot,
      indexPath,
      id: 'review',
      placementPath: claudeCopy
    })
    expect(await readFile(join(vaultRoot, 'review', 'SKILL.md'), 'utf8')).toContain('hand-edited')
    const scanAfterPromote = await scanSkillVault({
      homeDirectory: home,
      vaultRoot,
      candidatePaths: [claudeCopy],
      index: promotedIndex
    })
    expect(scanAfterPromote.counts.managed).toBe(1)
    expect(scanAfterPromote.counts.copyDrifted).toBe(0)

    // Modify copy again then Reset from Vault.
    await writeFile(
      join(claudeCopy, 'SKILL.md'),
      '---\nname: review\ndescription: v1\n---\ndiscard-me\n'
    )
    await resetCopyModeFromVault({
      vaultRoot,
      indexPath,
      id: 'review',
      placementPath: claudeCopy
    })
    expect(await readFile(join(claudeCopy, 'SKILL.md'), 'utf8')).toContain('hand-edited')
  })
})
