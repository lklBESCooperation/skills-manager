import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { planSkillEnablement } from './skill-enablement-planner'
import { resolveSkillProviderDestinations } from '../infra/skill-provider-destinations'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function sandbox(input?: { providers?: readonly string[] }): Promise<{
  home: string
  vaultRoot: string
  claudeRoot: string
  codexCanonicalRoot: string
  destinations: ReturnType<typeof resolveSkillProviderDestinations>
}> {
  const home = await mkdtemp(join(tmpdir(), 'orca-enablement-planner-'))
  roots.push(home)
  const vaultRoot = join(home, 'vault')
  const claudeRoot = join(home, '.claude', 'skills')
  const codexCanonicalRoot = join(home, '.agents', 'skills')
  await mkdir(vaultRoot, { recursive: true })
  await mkdir(join(home, 'project'), { recursive: true })
  const destinations = resolveSkillProviderDestinations({
    scope: 'global',
    homeDirectory: home,
    detectedProviders: input?.providers ?? ['claude', 'codex']
  })
  return { home, vaultRoot, claudeRoot, codexCanonicalRoot, destinations }
}

async function vaultSkill(vaultRoot: string, id: string): Promise<void> {
  await mkdir(join(vaultRoot, id), { recursive: true })
  await writeFile(join(vaultRoot, id, 'SKILL.md'), `---\nname: ${id}\n---\n# ${id}\n`)
}

describe('planSkillEnablement', () => {
  it('T2.7: diffs current links against the target and reports add/remove/keep', async () => {
    const { home, vaultRoot, destinations } = await sandbox()
    const ids = ['a', 'b', 'c', 'd', 'e']
    for (const id of ids) {
      await vaultSkill(vaultRoot, id)
    }
    const claudeRoot = join(home, '.claude', 'skills')
    await mkdir(claudeRoot, { recursive: true })
    await symlink(join(vaultRoot, 'a'), join(claudeRoot, 'a'), 'dir')
    await symlink(join(vaultRoot, 'b'), join(claudeRoot, 'b'), 'dir')

    const plan = await planSkillEnablement({
      vaultRoot,
      installedSkillIds: ids,
      userDefaults: {},
      projectOverrides: {},
      destinations: destinations.filter((destination) => !destination.readsCanonicalRoot)
    })

    expect(plan.counts.add).toBe(3)
    expect(plan.counts.remove).toBe(0)
    expect(plan.actions.filter((action) => action.kind === 'keep')).toHaveLength(2)
    expect(plan.counts.add).toBe(plan.actions.filter((a) => a.kind === 'add').length)
    expect(plan.counts.keep).toBe(plan.actions.filter((a) => a.kind === 'keep').length)
    expect(plan.counts.remove).toBe(plan.actions.filter((a) => a.kind === 'remove').length)
  })

  it('T2.8: disable plans link removal while Vault master stays permanent', async () => {
    const { home, vaultRoot, destinations } = await sandbox()
    const ids = ['a', 'b']
    for (const id of ids) {
      await vaultSkill(vaultRoot, id)
    }
    const claudeRoot = join(home, '.claude', 'skills')
    await mkdir(claudeRoot, { recursive: true })
    await symlink(join(vaultRoot, 'a'), join(claudeRoot, 'a'), 'dir')

    const plan = await planSkillEnablement({
      vaultRoot,
      installedSkillIds: ids,
      userDefaults: { a: 'disabled', b: 'disabled' },
      projectOverrides: {},
      destinations
    })

    expect(plan.counts.remove).toBe(1)
    expect(plan.counts.adoptCanonicalToVault).toBe(0)
    expect(plan.actions.every((action) => action.kind !== 'add')).toBe(true)
  })

  it('T2.9: canonical-root provider links directly to permanent Vault master (no move-to-canonical)', async () => {
    const { vaultRoot, destinations } = await sandbox({ providers: ['codex'] })
    await vaultSkill(vaultRoot, 'alpha')
    expect(destinations[0]?.readsCanonicalRoot).toBe(true)

    const plan = await planSkillEnablement({
      vaultRoot,
      installedSkillIds: ['alpha'],
      userDefaults: {},
      projectOverrides: {},
      destinations
    })

    expect(plan.actions).toHaveLength(1)
    expect(plan.actions[0]?.kind).toBe('add')
    expect(plan.counts.add).toBe(1)
    expect(plan.counts.adoptCanonicalToVault).toBe(0)
  })

  it('migrates legacy canonical-resident skill into Vault via adopt-canonical-to-vault', async () => {
    const { home, vaultRoot, destinations } = await sandbox({
      providers: ['codex']
    })
    await vaultSkill(vaultRoot, 'alpha')
    const canonicalRoot = join(home, '.agents', 'skills')
    await mkdir(canonicalRoot, { recursive: true })
    await rename(join(vaultRoot, 'alpha'), join(canonicalRoot, 'alpha'))

    const plan = await planSkillEnablement({
      vaultRoot,
      installedSkillIds: ['alpha'],
      userDefaults: { alpha: 'disabled' },
      projectOverrides: {},
      destinations,
      canonicalRoot
    })

    expect(plan.counts.adoptCanonicalToVault).toBe(1)
    expect(plan.counts.add).toBe(0)
  })

  it('plans per-agent matrix overrides independently across providers', async () => {
    const { vaultRoot, destinations } = await sandbox({ providers: ['claude', 'codex'] })
    await vaultSkill(vaultRoot, 'alpha')

    const plan = await planSkillEnablement({
      vaultRoot,
      installedSkillIds: ['alpha'],
      userDefaults: {},
      projectOverrides: {},
      userAgentOverrides: {
        alpha: { claude: true, codex: false }
      },
      destinations
    })

    const claudeAction = plan.actions.find((a) => a.observation.provider === 'claude')
    const codexAction = plan.actions.find((a) => a.observation.provider === 'codex')
    expect(claudeAction?.kind).toBe('add')
    expect(codexAction?.kind).toBe('keep')
  })

  it('reports a foreign directory at a target as a conflict, not a plan action', async () => {
    const { home, vaultRoot, destinations } = await sandbox()
    await vaultSkill(vaultRoot, 'alpha')
    const foreign = join(home, '.claude', 'skills', 'alpha')
    await mkdir(foreign, { recursive: true })
    await writeFile(join(foreign, 'SKILL.md'), 'user content')

    const plan = await planSkillEnablement({
      vaultRoot,
      installedSkillIds: ['alpha'],
      userDefaults: {},
      projectOverrides: {},
      destinations: destinations.filter((destination) => !destination.readsCanonicalRoot)
    })

    expect(plan.actions).toHaveLength(0)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]?.skillId).toBe('alpha')
    expect(plan.conflicts[0]?.provider).toBe('claude')
  })

  it('a link pointing outside the vault is a conflict, never silently relinked', async () => {
    const { home, vaultRoot, destinations } = await sandbox()
    await vaultSkill(vaultRoot, 'alpha')
    const elsewhere = join(home, 'elsewhere', 'alpha')
    await mkdir(join(home, 'elsewhere'), { recursive: true })
    await mkdir(elsewhere)
    await writeFile(join(elsewhere, 'SKILL.md'), 'other')
    const claudeRoot = join(home, '.claude', 'skills')
    await mkdir(claudeRoot, { recursive: true })
    await symlink(elsewhere, join(claudeRoot, 'alpha'), 'dir')

    const plan = await planSkillEnablement({
      vaultRoot,
      installedSkillIds: ['alpha'],
      userDefaults: {},
      projectOverrides: {},
      destinations: destinations.filter((destination) => !destination.readsCanonicalRoot)
    })

    expect(plan.actions).toHaveLength(0)
    expect(plan.conflicts).toHaveLength(1)
  })
})
