import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  projectStatePath,
  runSkillEnablementCommand,
  readSkillEnablementState,
  userDefaultsStatePath,
  type SkillEnablementRuntimeInput
} from './skill-enablement-applier'
import { fixtureSkillEnablementFileIO } from './skill-enablement-file-io.test-fixture'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

type Sandbox = {
  home: string
  project: string
  vaultRoot: string
  runtime: () => SkillEnablementRuntimeInput
}

async function sandbox(input?: { providers?: readonly string[] }): Promise<Sandbox> {
  const home = await mkdtemp(join(tmpdir(), 'orca-enablement-applier-'))
  roots.push(home)
  const project = join(home, 'project')
  const vaultRoot = join(home, '.pmstudio', 'skills')
  await mkdir(vaultRoot, { recursive: true })
  await mkdir(join(home, '.claude', 'skills'), { recursive: true })
  await mkdir(join(home, '.agents', 'skills'), { recursive: true })
  await mkdir(project, { recursive: true })
  return {
    home,
    project,
    vaultRoot,
    runtime: () => ({
      scope: 'global',
      homeDirectory: home,
      vaultRoot,
      stateDirectory: join(home, '.pmstudio', 'state'),
      detectedProviders: input?.providers ?? ['claude', 'codex'],
      fileIO: fixtureSkillEnablementFileIO(),
      ...(input?.providers ? { selectedProviders: input.providers } : {})
    })
  }
}

async function vaultSkill(vaultRoot: string, id: string): Promise<string> {
  const master = join(vaultRoot, id)
  await mkdir(master, { recursive: true })
  await writeFile(join(master, 'SKILL.md'), `---\nname: ${id}\n---\n# ${id}\n`)
  return master
}

describe('runSkillEnablementCommand (Vault-permanent placement transaction)', () => {
  it('T2.10: links both claude and canonical providers to permanent Vault master', async () => {
    const box = await sandbox()
    const vaultMaster = await vaultSkill(box.vaultRoot, 'alpha')
    const runtime = box.runtime()

    const result = await runSkillEnablementCommand({
      command: { kind: 'enable', skillIds: ['alpha'], scope: 'user' },
      runtime
    })

    expect(result.status).toBe('applied')
    const claudeLink = join(box.home, '.claude', 'skills', 'alpha')
    const canonicalLink = join(box.home, '.agents', 'skills', 'alpha')
    expect(await realpath(claudeLink)).toBe(await realpath(vaultMaster))
    expect(await realpath(canonicalLink)).toBe(await realpath(vaultMaster))
    expect(await readFile(join(vaultMaster, 'SKILL.md'), 'utf8')).toContain('# alpha')
    expect(result.executed.map((entry) => entry.action)).toEqual(['link', 'link'])
  })

  it('T2.11: replays an interrupted JournalV2 batch to convergence with no half-enabled state', async () => {
    const box = await sandbox()
    await vaultSkill(box.vaultRoot, 'alpha')
    await vaultSkill(box.vaultRoot, 'beta')
    const runtime = box.runtime()

    await expect(
      runSkillEnablementCommand({
        command: { kind: 'enable', skillIds: ['alpha', 'beta'], scope: 'user' },
        runtime,
        interruptAfterCount: 1
      })
    ).rejects.toThrow('skill-enablement-interrupted')

    const after = await readSkillEnablementState({ runtime })
    const enabledCount = [...after.resolution.values()].filter(
      (value) => value.effective === 'enabled'
    ).length
    expect(enabledCount).toBe(2)

    const rerun = await runSkillEnablementCommand({
      command: { kind: 'enable', skillIds: ['alpha', 'beta'], scope: 'user' },
      runtime
    })
    expect(rerun.status).toBe('applied')

    for (const id of ['alpha', 'beta']) {
      const expectedMaster = await realpath(join(box.vaultRoot, id))
      expect(await realpath(join(box.home, '.claude', 'skills', id))).toBe(expectedMaster)
      expect(await realpath(join(box.home, '.agents', 'skills', id))).toBe(expectedMaster)
    }
    const journal = join(box.home, '.pmstudio', 'state', 'enablement-journal.json')
    await expect(realpath(journal)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('T2.12: deleting the project state file recomputes to the same state as never overriding', async () => {
    const box = await sandbox()
    await vaultSkill(box.vaultRoot, 'alpha')
    const globalRuntime = box.runtime()
    await runSkillEnablementCommand({
      command: { kind: 'disable', skillIds: ['alpha'], scope: 'user' },
      runtime: globalRuntime
    })
    const projectRuntime: SkillEnablementRuntimeInput = {
      ...globalRuntime,
      scope: 'workspace',
      workspaceDirectory: box.project
    }
    await runSkillEnablementCommand({
      command: { kind: 'enable', skillIds: ['alpha'], scope: 'project' },
      runtime: projectRuntime
    })
    const overridden = await readSkillEnablementState({
      runtime: projectRuntime
    })
    expect(overridden.resolution.get('alpha')).toEqual({
      effective: 'enabled',
      origin: 'project'
    })

    await rm(projectStatePath(box.project), { force: true })

    const afterDelete = await readSkillEnablementState({
      runtime: projectRuntime
    })
    expect(afterDelete.resolution.get('alpha')).toEqual({
      effective: 'disabled',
      origin: 'user'
    })
    const neverOverridden = await readSkillEnablementState({
      runtime: globalRuntime
    })
    expect(neverOverridden.resolution.get('alpha')).toEqual({
      effective: 'disabled',
      origin: 'user'
    })
  })

  it('inherit deletes the project key and re-places from the resolution', async () => {
    const box = await sandbox()
    await vaultSkill(box.vaultRoot, 'alpha')
    const runtime: SkillEnablementRuntimeInput = {
      ...box.runtime(),
      scope: 'workspace',
      workspaceDirectory: box.project
    }
    await runSkillEnablementCommand({
      command: { kind: 'enable', skillIds: ['alpha'], scope: 'project' },
      runtime
    })
    const stateFile = projectStatePath(box.project)
    expect(JSON.parse(await readFile(stateFile, 'utf8')).overrides.alpha).toBe('enabled')

    await runSkillEnablementCommand({
      command: { kind: 'inherit', skillIds: ['alpha'] },
      runtime
    })

    expect(JSON.parse(await readFile(stateFile, 'utf8')).overrides).toEqual({})
    const after = await readSkillEnablementState({ runtime })
    expect(after.resolution.get('alpha')).toEqual({
      effective: 'enabled',
      origin: 'user'
    })
  })

  it('persists user defaults in the state file and honors them on the next read', async () => {
    const box = await sandbox()
    await vaultSkill(box.vaultRoot, 'alpha')
    const runtime = box.runtime()

    await runSkillEnablementCommand({
      command: { kind: 'disable', skillIds: ['alpha'], scope: 'user' },
      runtime
    })

    const persisted = JSON.parse(await readFile(userDefaultsStatePath(box.home), 'utf8'))
    expect(persisted).toEqual({
      schemaVersion: 1,
      defaults: { alpha: 'disabled' }
    })
    const state = await readSkillEnablementState({ runtime })
    expect(state.resolution.get('alpha')).toEqual({
      effective: 'disabled',
      origin: 'user'
    })
  })

  it('supports per-agent overrides (`agents: { claude: true, codex: false }`)', async () => {
    const box = await sandbox({ providers: ['claude', 'codex'] })
    const vaultMaster = await vaultSkill(box.vaultRoot, 'alpha')
    const runtime = box.runtime()

    await runSkillEnablementCommand({
      command: {
        kind: 'enable',
        skillIds: ['alpha'],
        scope: 'user',
        agents: { claude: true, codex: false }
      },
      runtime
    })

    expect(await realpath(join(box.home, '.claude', 'skills', 'alpha'))).toBe(
      await realpath(vaultMaster)
    )
    await expect(realpath(join(box.home, '.agents', 'skills', 'alpha'))).rejects.toMatchObject({
      code: 'ENOENT'
    })

    const state = await readSkillEnablementState({ runtime, includeAgents: true })
    expect(state.resolution.get('alpha')?.agents?.claude).toBe(true)
    expect(state.resolution.get('alpha')?.agents?.codex).toBe(false)
  })

  it('leaves a foreign directory untouched and reports the conflict', async () => {
    const box = await sandbox()
    await vaultSkill(box.vaultRoot, 'alpha')
    const foreign = join(box.home, '.claude', 'skills', 'alpha')
    await mkdir(foreign, { recursive: true })
    await writeFile(join(foreign, 'SKILL.md'), 'user content')

    const result = await runSkillEnablementCommand({
      command: { kind: 'enable', skillIds: ['alpha'], scope: 'user' },
      runtime: box.runtime()
    })

    expect(result.status).toBe('partial')
    expect(result.conflicts).toEqual([
      {
        skillId: 'alpha',
        provider: 'claude',
        rootPath: join(box.home, '.claude', 'skills')
      }
    ])
    expect(await readFile(join(foreign, 'SKILL.md'), 'utf8')).toBe('user content')
  })

  it('refuses unknown skill ids before touching the filesystem', async () => {
    const box = await sandbox()
    await expect(
      runSkillEnablementCommand({
        command: { kind: 'enable', skillIds: ['ghost'], scope: 'user' },
        runtime: box.runtime()
      })
    ).rejects.toThrow('skill-enablement-unknown-skill: ghost')
  })

  it('migrates symlinked canonical skills into Vault while keeping external library intact', async () => {
    const box = await sandbox()
    const canonicalRoot = join(box.home, '.agents', 'skills')
    const libraryRoot = join(box.home, 'library')
    await vaultSkill(libraryRoot, 'external-skill')
    await symlink(join(libraryRoot, 'external-skill'), join(canonicalRoot, 'external-skill'), 'dir')
    await symlink(join(libraryRoot, 'missing'), join(canonicalRoot, 'broken-link'), 'dir')
    await symlink(
      join(libraryRoot, 'external-skill', 'SKILL.md'),
      join(canonicalRoot, 'file-link'),
      'file'
    )
    await mkdir(join(canonicalRoot, '.hidden'), { recursive: true })

    const state = await readSkillEnablementState({ runtime: box.runtime() })
    expect([...state.resolution.keys()]).toEqual(['external-skill'])
    expect(state.resolution.get('external-skill')?.effective).toBe('enabled')

    const result = await runSkillEnablementCommand({
      command: { kind: 'enable', skillIds: ['external-skill'], scope: 'user' },
      runtime: box.runtime()
    })
    expect(result.status).toBe('applied')
    expect(result.conflicts).toEqual([])
    expect(await realpath(join(canonicalRoot, 'external-skill'))).toBe(
      await realpath(join(libraryRoot, 'external-skill'))
    )
    expect(await realpath(join(box.home, '.claude', 'skills', 'external-skill'))).toBe(
      await realpath(join(libraryRoot, 'external-skill'))
    )

    await runSkillEnablementCommand({
      command: { kind: 'disable', skillIds: ['external-skill'], scope: 'user' },
      runtime: box.runtime()
    })
    await expect(realpath(join(canonicalRoot, 'external-skill'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(await realpath(join(box.vaultRoot, 'external-skill'))).toBe(
      await realpath(join(libraryRoot, 'external-skill'))
    )
    expect(await readFile(join(libraryRoot, 'external-skill', 'SKILL.md'), 'utf8')).toContain(
      '# external-skill'
    )
  })

  it('disable removes links but keeps the vault primary (re-enablable)', async () => {
    const box = await sandbox({ providers: ['claude'] })
    await vaultSkill(box.vaultRoot, 'alpha')
    const runtime = box.runtime()
    await runSkillEnablementCommand({
      command: { kind: 'enable', skillIds: ['alpha'], scope: 'user' },
      runtime
    })
    const claudeLink = join(box.home, '.claude', 'skills', 'alpha')

    await runSkillEnablementCommand({
      command: { kind: 'disable', skillIds: ['alpha'], scope: 'user' },
      runtime
    })

    await expect(realpath(claudeLink)).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(await readFile(join(box.vaultRoot, 'alpha', 'SKILL.md'), 'utf8')).toContain('# alpha')

    const reEnabled = await runSkillEnablementCommand({
      command: { kind: 'enable', skillIds: ['alpha'], scope: 'user' },
      runtime
    })
    expect(reEnabled.status).toBe('applied')
    expect(await realpath(claudeLink)).toBe(await realpath(join(box.vaultRoot, 'alpha')))
  })

  it('degrades corrupt state files to salvage instead of failing the run', async () => {
    const box = await sandbox()
    await vaultSkill(box.vaultRoot, 'alpha')
    const defaultsPath = userDefaultsStatePath(box.home)
    await mkdir(join(box.home, '.pmstudio'), { recursive: true })
    await writeFile(defaultsPath, '{corrupt json', 'utf8')

    const result = await runSkillEnablementCommand({
      command: { kind: 'disable', skillIds: ['alpha'], scope: 'user' },
      runtime: box.runtime()
    })

    expect(result.status).toBe('applied')
    expect(result.stateFileUnreadable).toBe(true)
    const persisted = JSON.parse(await readFile(defaultsPath, 'utf8'))
    expect(persisted.defaults).toEqual({ alpha: 'disabled' })
  })
})
