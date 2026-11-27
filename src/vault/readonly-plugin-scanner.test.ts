import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanReadonlyPluginSkills } from './readonly-plugin-scanner'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('scanReadonlyPluginSkills', () => {
  it('scans Claude, Codex, Cursor, and sibling Orca plugin skills as strictly readonly', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orca-ro-plugin-scan-'))
    roots.push(home)

    const workspace = join(home, 'workspace-a')
    const claudePluginDir = join(home, '.claude', 'plugins', 'cache', 'official', 'review-kit', '1.0.0')
    await mkdir(join(claudePluginDir, '.claude-plugin'), { recursive: true })
    await mkdir(join(claudePluginDir, 'skills', 'code-review'), { recursive: true })
    await writeFile(
      join(claudePluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ id: 'review-kit@official', name: 'review-kit' })
    )
    await writeFile(
      join(claudePluginDir, 'skills', 'code-review', 'SKILL.md'),
      '---\nname: Code Review\ndescription: Review PRs safely\n---\n'
    )

    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'review-kit@official': true } })
    )
    await writeFile(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'review-kit@official': [
            { scope: 'user', installPath: claudePluginDir }
          ]
        }
      })
    )

    const codexSysSkill = join(home, '.codex', 'skills', '.system', 'skill-creator')
    await mkdir(codexSysSkill, { recursive: true })
    await writeFile(
      join(codexSysSkill, 'SKILL.md'),
      '---\nname: Skill Creator\ndescription: Built-in codex skill\n---\n'
    )

    const cursorSkill = join(home, '.cursor', 'skills-cursor', 'cursor-help')
    await mkdir(cursorSkill, { recursive: true })
    await writeFile(
      join(cursorSkill, 'SKILL.md'),
      '---\nname: Cursor Help\ndescription: Cursor built-in\n---\n'
    )

    const pluginsRoot = join(home, 'orca-plugins')
    const selfPlugin = join(pluginsRoot, 'skills-manager')
    const siblingPlugin = join(pluginsRoot, 'sibling-helper')
    await mkdir(selfPlugin, { recursive: true })
    await mkdir(join(siblingPlugin, 'skills', 'helper-skill'), { recursive: true })
    await writeFile(
      join(siblingPlugin, 'orca-plugin.json'),
      JSON.stringify({ id: 'sibling-helper', name: 'Sibling Helper' })
    )
    await writeFile(
      join(siblingPlugin, 'skills', 'helper-skill', 'SKILL.md'),
      '---\nname: Sibling Helper Skill\ndescription: From sibling orca plugin\n---\n'
    )

    const result = await scanReadonlyPluginSkills({
      homeDirectory: home,
      workspaceDirectory: workspace,
      pluginRoot: selfPlugin,
      etcCodexSkillsRoot: join(home, 'nonexistent-etc-codex')
    })

    expect(result.skills.every((s) => s.readonly === true)).toBe(true)
    const byId = new Map(result.skills.map((s) => [s.id, s]))

    const review = byId.get('code-review')
    expect(review).toBeDefined()
    expect(review?.agent).toBe('claude')
    expect(review?.invocationCommand).toBe('/review-kit:code-review')
    expect(review?.activationState).toBe('active')
    expect(review?.marketplace).toBe('official')

    expect(byId.get('skill-creator')?.sourceCategory).toBe('bundled-readonly')
    expect(byId.get('cursor-help')?.agent).toBe('cursor')
    expect(byId.get('helper-skill')?.pluginName).toBe('Sibling Helper')
    expect(result.readonlyRoots).toContain(claudePluginDir)
    expect(result.readonlyRoots).toContain(siblingPlugin)
  })
})
