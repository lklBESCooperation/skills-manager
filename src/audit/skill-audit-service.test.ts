import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditSkillsHealth } from './skill-audit-service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('auditSkillsHealth (read-only diagnostics)', () => {
  it('detects orphan symlinks, duplicates, conflicts, retired roots, and plugin collisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-audit-'))
    roots.push(root)
    const home = join(root, 'home')
    const vaultRoot = join(home, '.pmstudio', 'skills')
    await mkdir(vaultRoot, { recursive: true })
    await mkdir(join(home, '.claude', 'skills'), { recursive: true })
    await mkdir(join(home, '.codex', 'skills'), { recursive: true })
    await mkdir(join(home, '.gemini', 'skills', 'legacy-skill'), { recursive: true })

    // Orphan symlink
    await symlink(join(home, 'missing-target'), join(home, '.claude', 'skills', 'broken-skill'), 'dir')

    // Duplicate same digest
    await mkdir(join(home, '.claude', 'skills', 'dup'), { recursive: true })
    await writeFile(join(home, '.claude', 'skills', 'dup', 'SKILL.md'), '---\nname: dup\n---\nsame\n')
    await mkdir(join(home, '.codex', 'skills', 'dup'), { recursive: true })
    await writeFile(join(home, '.codex', 'skills', 'dup', 'SKILL.md'), '---\nname: dup\n---\nsame\n')

    // Digest conflict
    await mkdir(join(home, '.claude', 'skills', 'clash'), { recursive: true })
    await writeFile(join(home, '.claude', 'skills', 'clash', 'SKILL.md'), '---\nname: clash\n---\nA\n')
    await mkdir(join(home, '.codex', 'skills', 'clash'), { recursive: true })
    await writeFile(join(home, '.codex', 'skills', 'clash', 'SKILL.md'), '---\nname: clash\n---\nB\n')

    // Vault skill colliding with a plugin skill
    await mkdir(join(vaultRoot, 'commit-helper'), { recursive: true })
    await writeFile(join(vaultRoot, 'commit-helper', 'SKILL.md'), '---\nname: commit-helper\n---\n')

    // Symlink in writable root pointing into Claude plugin cache
    const pluginSkillDir = join(home, '.claude', 'plugins', 'cache', 'plug', 'skills', 'p1')
    await mkdir(pluginSkillDir, { recursive: true })
    await writeFile(join(pluginSkillDir, 'SKILL.md'), '---\nname: p1\n---\n')
    await symlink(pluginSkillDir, join(home, '.claude', 'skills', 'exposed-plugin'), 'dir')

    const report = await auditSkillsHealth({
      scope: 'global',
      homeDirectory: home,
      vaultRoot,
      pluginSkills: [
        {
          id: 'commit-helper',
          name: 'commit-helper',
          description: 'Plugin commit helper',
          readonly: true,
          sourceCategory: 'plugin',
          pluginId: 'git@official',
          pluginName: 'git',
          agent: 'claude',
          scope: 'user',
          installPath: join(home, '.claude', 'plugins', 'cache', 'git'),
          skillDirectoryPath: join(home, '.claude', 'plugins', 'cache', 'git', 'skills', 'commit-helper'),
          skillFilePath: join(home, '.claude', 'plugins', 'cache', 'git', 'skills', 'commit-helper', 'SKILL.md'),
          invocationCommand: '/git:commit-helper',
          activationState: 'active'
        }
      ]
    })

    expect(report.summary.orphanSymlinks).toBe(1)
    expect(report.summary.duplicates).toBe(1)
    expect(report.summary.conflicts).toBe(1)
    expect(report.summary.retiredRoots).toBe(1)
    expect(report.summary.readonlyPluginExposures).toBe(1)
    expect(report.summary.pluginCollisions).toBe(1)
    expect(report.summary.pluginSkillsTotal).toBe(1)
    expect(report.summary.pluginSkillsActive).toBe(1)
  })
})
