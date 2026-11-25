import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertWritableSkillTarget,
  ReadonlySkillProtectedError
} from './readonly-root-fence'
import { adoptSkillsIntoVault } from '../vault/skill-vault-adopt'
import { scanSkillVault } from '../vault/skill-vault-scan'
import { runSkillEnablementCommand } from '../enablement/skill-enablement-applier'
import { fixtureSkillEnablementFileIO } from '../enablement/skill-enablement-file-io.test-fixture'
import { SkillPackService } from '../packs/skill-pack-service'
import { createLocalSkillInVault } from '../editor/skill-editor-service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

describe('Plugin Skills dual-layer readonly fence & symlink penetration guard', () => {
  it('blocks static plugin prefixes and dynamic plugin roots via lexical and realpath checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-readonly-fence-'))
    roots.push(root)
    const home = join(root, 'home')
    const pluginCacheSkill = join(home, '.claude', 'plugins', 'cache', 'foo', 'skills', 'bar')
    const dynamicPluginRoot = join(home, 'custom-plugins', 'ext-a')
    const dynamicPluginSkill = join(dynamicPluginRoot, 'skills', 'baz')
    await mkdir(pluginCacheSkill, { recursive: true })
    await mkdir(dynamicPluginSkill, { recursive: true })
    const pluginSkillMd = join(pluginCacheSkill, 'SKILL.md')
    await writeFile(pluginSkillMd, '---\nname: bar\ndescription: plugin\n---\nimmutable\n')
    const dynSkillMd = join(dynamicPluginSkill, 'SKILL.md')
    await writeFile(dynSkillMd, '---\nname: baz\ndescription: dyn\n---\nimmutable\n')

    const beforeStat = await stat(pluginSkillMd)
    const beforeHash = sha256(await readFile(pluginSkillMd, 'utf8'))

    // Create a symlink inside a writable user folder pointing into the Claude plugin cache.
    const writableRoot = join(home, '.claude', 'skills')
    await mkdir(writableRoot, { recursive: true })
    const evilLink = join(writableRoot, 'evil-link')
    await symlink(pluginCacheSkill, evilLink, 'dir')

    // Also create a nested symlink pointing into a dynamic plugin root.
    const nestedEvilLink = join(writableRoot, 'nested-evil')
    await symlink(dynamicPluginSkill, nestedEvilLink, 'dir')

    await expect(assertWritableSkillTarget(pluginCacheSkill)).rejects.toBeInstanceOf(
      ReadonlySkillProtectedError
    )
    await expect(assertWritableSkillTarget(evilLink)).rejects.toMatchObject({
      code: 'skill-readonly-plugin-protected'
    })
    await expect(
      assertWritableSkillTarget(nestedEvilLink, { readonlyRoots: [dynamicPluginRoot] })
    ).rejects.toMatchObject({
      code: 'skill-readonly-plugin-protected'
    })

    // 1. scanSkillVault skips both direct plugin paths and symlink-to-plugin paths.
    const scanPlan = await scanSkillVault({
      homeDirectory: home,
      vaultRoot: join(home, '.pmstudio', 'skills'),
      candidatePaths: [pluginCacheSkill, evilLink, nestedEvilLink],
      readonlyRoots: [dynamicPluginRoot]
    })
    expect(scanPlan.items).toEqual([])
    expect(scanPlan.counts.skippedReadonly).toBe(3)

    // 2. adoptSkillsIntoVault rejects symlink penetration into plugin cache.
    await expect(
      adoptSkillsIntoVault({
        homeDirectory: home,
        vaultRoot: join(home, '.pmstudio', 'skills'),
        indexPath: join(home, '.pmstudio', 'skills-index.json'),
        items: [{ id: 'evil-link', originPath: evilLink, mergePaths: [] }]
      })
    ).rejects.toBeInstanceOf(ReadonlySkillProtectedError)

    // 3. runSkillEnablementCommand blocks writing into a provider root overridden to a plugin dir.
    const vaultRoot = join(home, '.pmstudio', 'skills')
    await mkdir(join(vaultRoot, 'alpha'), { recursive: true })
    await writeFile(join(vaultRoot, 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n')
    const enableResult = await runSkillEnablementCommand({
      command: { kind: 'enable', skillIds: ['alpha'], scope: 'user' },
      runtime: {
        scope: 'global',
        homeDirectory: home,
        vaultRoot,
        stateDirectory: join(home, '.pmstudio', 'state'),
        detectedProviders: ['claude'],
        providerRootOverrides: { claude: join(home, '.claude', 'plugins', 'cache') },
        fileIO: fixtureSkillEnablementFileIO()
      }
    })
    expect(enableResult.readonlyBlocked).toHaveLength(1)

    // 4. SkillPackService refuses saving a pack containing a readonly plugin skill id.
    const packService = new SkillPackService(join(home, '.pmstudio', 'packs.json'), {
      getCurrent: async () => new Set(['alpha']),
      getInstalled: async () => new Set(['alpha']),
      onApplyDiff: async () => undefined,
      isReadonlySkillId: (id) => id === 'bar'
    })
    await expect(
      packService.save({
        id: 'bad-pack',
        name: 'Bad Pack',
        members: ['bar'],
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z'
      })
    ).rejects.toThrow('skill-readonly-plugin-protected')

    // 5. Editor refuses creating into a vault path inside a readonly root.
    await expect(
      createLocalSkillInVault(
        {
          vaultRoot: join(home, '.claude', 'plugins', 'vault'),
          indexPath: join(home, '.pmstudio', 'skills-index.json')
        },
        { id: 'x', name: 'x', description: 'x' }
      )
    ).rejects.toBeInstanceOf(ReadonlySkillProtectedError)

    // Verify plugin cache inode and digest remained 100% untouched.
    const afterStat = await stat(pluginSkillMd)
    const afterHash = sha256(await readFile(pluginSkillMd, 'utf8'))
    expect(afterStat.ino).toBe(beforeStat.ino)
    expect(afterHash).toBe(beforeHash)
  })
})
