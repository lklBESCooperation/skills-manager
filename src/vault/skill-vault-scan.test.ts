import { mkdir, mkdtemp, rm, symlink, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeSkillInstallReceipt } from '../infra/skill-state-store'
import { scanSkillVault } from './skill-vault-scan'
import { userSkillVaultRoot } from './skill-vault-paths'

const roots: string[] = []

let home: string
let vaultRoot: string
let claudeSkills: string
let codexSkills: string

async function makeHome(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'orca-skill-vault-scan-'))
  roots.push(root)
  home = join(root, 'home')
  vaultRoot = userSkillVaultRoot(home)
  claudeSkills = join(home, '.claude', 'skills')
  codexSkills = join(home, '.codex', 'skills')
  await mkdir(claudeSkills, { recursive: true })
  await mkdir(codexSkills, { recursive: true })
}

async function writeSkill(directory: string, name: string, body = `# ${name}\n`): Promise<string> {
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name}\n---\n\n${body}`
  )
  return directory
}

/** Same file bytes at two roots produce the same tree digest. */
async function writeIdenticalSkill(directory: string, name: string): Promise<string> {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\n---\n\nBody for ${name}.\n`)
  return directory
}

beforeEach(makeHome)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function scan(candidatePaths: string[]) {
  return scanSkillVault({
    homeDirectory: home,
    vaultRoot,
    candidatePaths
  })
}

describe('scanSkillVault attribution', () => {
  it('plans two independent primaries as adoptable=2 (T1.3)', async () => {
    await writeSkill(join(claudeSkills, 'review'), 'review')
    await writeSkill(join(codexSkills, 'planning'), 'planning')

    const plan = await scan([join(claudeSkills, 'review'), join(codexSkills, 'planning')])

    expect(plan.counts.adoptable).toBe(2)
    expect(plan.counts.merged).toBe(0)
    expect(plan.items.map((item) => item.disposition)).toEqual(['adoptable', 'adoptable'])
  })

  it('merges a same-digest duplicate into one adoptable plus a link (T1.4)', async () => {
    await writeIdenticalSkill(join(claudeSkills, 'review'), 'review')
    await writeIdenticalSkill(join(codexSkills, 'review'), 'review')

    const plan = await scan([join(claudeSkills, 'review'), join(codexSkills, 'review')])

    expect(plan.counts.adoptable).toBe(1)
    expect(plan.counts.merged).toBe(1)
    const item = plan.items.find((candidate) => candidate.id === 'review')
    expect(item?.disposition).toBe('adoptable')
    expect(item?.mergePaths).toEqual([join(codexSkills, 'review')])
  })

  it('flags same-name different-digest copies as conflict and adopts nothing (T1.5)', async () => {
    await writeSkill(join(claudeSkills, 'review'), 'review', 'Claude edition\n')
    await writeSkill(join(codexSkills, 'review'), 'review', 'Codex edition\n')

    const plan = await scan([join(claudeSkills, 'review'), join(codexSkills, 'review')])

    expect(plan.counts.conflicts).toBe(1)
    expect(plan.counts.adoptable).toBe(0)
    const conflict = plan.items.find((candidate) => candidate.id === 'review')
    expect(conflict?.disposition).toBe('conflict')
    expect(conflict?.conflicts).toHaveLength(2)
    expect(new Set(conflict?.conflicts.map((variant) => variant.digest)).size).toBe(2)
  })

  it('marks a link already pointing into the vault as managed with no action (T1.6)', async () => {
    const vaultEntry = join(vaultRoot, 'review')
    await writeSkill(vaultEntry, 'review')
    const linkPath = join(claudeSkills, 'review')
    await symlink(vaultEntry, linkPath, process.platform === 'win32' ? 'junction' : 'dir')

    const plan = await scan([linkPath])

    expect(plan.counts.managed).toBe(1)
    expect(plan.counts.adoptable).toBe(0)
    expect(plan.items[0]?.disposition).toBe('managed')
  })

  it('skips a skill with an Orca install receipt as orca-managed (T1.7)', async () => {
    const skillDirectory = join(claudeSkills, 'pms-cli')
    await writeSkill(skillDirectory, 'pms-cli')
    const stateDirectory = join(roots[0], 'state')
    await writeSkillInstallReceipt(stateDirectory, {
      schemaVersion: 1,
      packageId: 'pkg',
      versionId: 'ver',
      packageDigest: 'd'.repeat(64),
      archiveSha256: 'a'.repeat(64),
      scope: 'global',
      destinationIdentity: 'dest',
      canonicalPath: skillDirectory,
      placements: [],
      installedAt: '2026-11-01T00:00:00.000Z',
      hostIdentity: 'host'
    })

    const plan = await scanSkillVault({
      homeDirectory: home,
      vaultRoot,
      candidatePaths: [skillDirectory],
      installStateDirectory: stateDirectory
    })

    expect(plan.counts.orcaManaged).toBe(1)
    expect(plan.items[0]?.disposition).toBe('orca-managed')
  })

  it('produces identical plans on consecutive runs (T1.8 idempotence)', async () => {
    await writeSkill(join(claudeSkills, 'review'), 'review')
    await writeIdenticalSkill(join(codexSkills, 'shared'), 'shared')
    await writeIdenticalSkill(join(claudeSkills, 'shared'), 'shared')
    const candidatePaths = [
      join(claudeSkills, 'review'),
      join(claudeSkills, 'shared'),
      join(codexSkills, 'shared')
    ]

    const first = await scan(candidatePaths)
    const second = await scan(candidatePaths)

    expect(second).toEqual(first)
  })

  it('records differing mtimes inside a conflict for the user decision', async () => {
    const left = await writeSkill(join(claudeSkills, 'review'), 'review', 'left\n')
    const right = await writeSkill(join(codexSkills, 'review'), 'review', 'right\n')
    await utimes(
      join(left, 'SKILL.md'),
      new Date('2026-11-01T00:00:00Z'),
      new Date('2026-11-01T00:00:00Z')
    )
    await utimes(
      join(right, 'SKILL.md'),
      new Date('2026-11-02T00:00:00Z'),
      new Date('2026-11-02T00:00:00Z')
    )

    const plan = await scan([left, right])

    const conflict = plan.items[0]
    expect(conflict?.conflicts.map((variant) => variant.mtimeMs)).not.toEqual([
      conflict?.conflicts[0]?.mtimeMs,
      conflict?.conflicts[0]?.mtimeMs
    ])
  })
})
