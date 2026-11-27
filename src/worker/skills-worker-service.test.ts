import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SkillMutateInputSchema } from '../contracts/skill-ui-bridge-contract'
import { SkillsWorkerService } from './skills-worker-service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createTestSkill(root: string, id: string, name: string, description: string): Promise<void> {
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`
  )
}

describe('SkillsWorkerService', () => {
  it('aggregates user + workspace + canonical-unindexed + adoptable + readonly plugin skills and supports mutations/packs/audit', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orca-worker-service-'))
    roots.push(home)

    const wsDir = join(home, 'repo-ws')
    await mkdir(join(home, '.pmstudio', 'skills'), { recursive: true })
    await mkdir(join(home, '.agents', 'skills'), { recursive: true })
    await mkdir(join(home, '.claude', 'skills'), { recursive: true })
    await mkdir(join(wsDir, '.pmstudio', 'skills'), { recursive: true })
    await mkdir(join(wsDir, '.agents', 'skills'), { recursive: true })

    // 1. User vault skill
    await createTestSkill(join(home, '.pmstudio', 'skills'), 'alpha-skill', 'Alpha Skill', 'Global alpha')
    // 2. Canonical-unindexed user skill
    await createTestSkill(join(home, '.agents', 'skills'), 'beta-canonical', 'Beta Canonical', 'Unindexed shared')
    // 3. Workspace vault skill
    await createTestSkill(join(wsDir, '.pmstudio', 'skills'), 'gamma-ws', 'Gamma Workspace', 'Project specific')
    // 4. Adoptable skill sitting in Claude root
    await createTestSkill(join(home, '.claude', 'skills'), 'delta-adopt', 'Delta Adoptable', 'Waiting adopt')
    // 5. Readonly Codex system skill
    await createTestSkill(join(home, '.codex', 'skills', '.system'), 'codex-sys', 'Codex Sys', 'System readonly')

    let focusedHostId: string | null = 'local'

    const service = new SkillsWorkerService({
      homeDirectory: home,
      etcCodexSkillsRoot: join(home, 'none-etc-codex'),
      hostBridge: {
        readWorkspaceContext: async () => ({
          workspaceId: 'ws-1',
          branch: 'main',
          displayName: 'repo-ws'
        }),
        listWorkspaces: async () => ({
          workspaces: [
            {
              id: 'ws-1',
              kind: 'worktree',
              name: 'repo-ws',
              path: wsDir,
              branch: 'main',
              hostId: focusedHostId
            }
          ]
        })
      }
    })

    const snap = await service.getWorkbenchSnapshot()
    expect(snap.activeWorkspace.isLocalDirectoryAvailable).toBe(true)
    expect(snap.agentRegistry).toHaveLength(45)
    expect(snap.managedSkills.map((s) => s.rowKey).sort()).toEqual([
      'user:alpha-skill',
      'user:beta-canonical',
      'workspace:gamma-ws'
    ])
    expect(snap.managedSkills.find((s) => s.id === 'beta-canonical')?.sourceKind).toBe(
      'canonical-unindexed'
    )
    expect(snap.adoptableSkills.map((a) => a.id)).toEqual(['beta-canonical', 'delta-adopt'])
    expect(snap.pluginSkills.map((p) => p.id)).toEqual(['codex-sys'])

    // Toggle alpha-skill disabled in project scope, then restore inherit
    const disabled = await service.mutateEnablement({
      kind: 'disable',
      skillIds: ['alpha-skill'],
      writeScope: 'project',
      skillScope: 'user'
    })
    expect(disabled.status).toBe('applied')
    expect(disabled.updatedSkills[0]?.effective).toBe('disabled')
    expect(disabled.updatedSkills[0]?.origin).toBe('project')

    // Per-agent override + inherit restore
    const perAgentInput = SkillMutateInputSchema.parse({
      kind: 'disable',
      skillIds: ['alpha-skill'],
      writeScope: 'project',
      skillScope: 'user',
      agents: { claude: false }
    })
    const perAgentRes = await service.mutateEnablement(perAgentInput)
    expect(perAgentRes.updatedSkills[0]?.agents.claude).toBe(false)

    const inherited = await service.mutateEnablement({
      kind: 'inherit',
      skillIds: ['alpha-skill'],
      writeScope: 'project',
      skillScope: 'user'
    })
    expect(inherited.updatedSkills[0]?.effective).toBe('enabled')
    expect(inherited.updatedSkills[0]?.origin).toBe('user')

    // Blocking mutation on readonly plugin skill id
    const roAttempt = await service.mutateEnablement({
      kind: 'disable',
      skillIds: ['codex-sys'],
      writeScope: 'user'
    })
    expect(roAttempt.readonlyBlocked.length).toBeGreaterThan(0)

    // Adopt delta-adopt into User vault
    const adopted = await service.adoptSkills({ scope: 'user', skillIds: ['delta-adopt'] })
    expect(adopted.adoptedIds).toEqual(['delta-adopt'])

    // Packs: saveCurrent -> preview -> apply -> rollback
    const savedPack = await service.saveCurrentPack({
      scope: 'user',
      id: 'core-pack',
      name: 'Core Pack'
    })
    expect(savedPack.id).toBe('core-pack')

    await service.mutateEnablement({
      kind: 'disable',
      skillIds: ['alpha-skill'],
      writeScope: 'user',
      skillScope: 'user'
    })
    const preview = await service.previewPack({ scope: 'user', id: 'core-pack', mode: 'switch' })
    expect(preview.diff.enable).toContain('alpha-skill')

    const applied = await service.applyPack({ scope: 'user', id: 'core-pack', mode: 'switch' })
    expect(applied.undoId).toBeTruthy()
    await service.rollbackPack({ scope: 'user', undoId: applied.undoId })

    // Audit runs cleanly
    const audit = await service.runAudit('user')
    expect(audit.summary.pluginSkillsTotal).toBe(1)

    // Remote workspace hostId falls back to global mode
    focusedHostId = 'ssh:remote-box'
    const remoteSnap = await service.getQuickPanelSnapshot()
    expect(remoteSnap.activeWorkspace.isLocalDirectoryAvailable).toBe(false)
    expect(remoteSnap.managedSkills.every((s) => s.scope === 'user')).toBe(true)
  })

  it('auto-adopts canonical-unindexed skills on enablement mutation in both project and user scopes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orca-worker-canonical-'))
    roots.push(home)

    const wsDir = join(home, 'repo-ws')
    await mkdir(join(home, '.agents', 'skills'), { recursive: true })
    await mkdir(join(home, '.claude', 'skills'), { recursive: true })
    await mkdir(join(wsDir, '.agents', 'skills'), { recursive: true })

    // User canonical-unindexed skill with empty ~/.pmstudio/skills vault
    await createTestSkill(join(home, '.agents', 'skills'), 'rex', 'Rex', 'Canonical user skill')
    // Second canonical-unindexed skill for user-scope toggle
    await createTestSkill(join(home, '.agents', 'skills'), 'solo-user', 'Solo User', 'User global toggle')
    // Workspace canonical-unindexed skill with empty workspace vault
    await createTestSkill(join(wsDir, '.agents', 'skills'), 'ws-canon', 'WS Canon', 'Workspace canonical')

    const service = new SkillsWorkerService({
      homeDirectory: home,
      etcCodexSkillsRoot: join(home, 'none-etc-codex'),
      hostBridge: {
        readWorkspaceContext: async () => ({
          workspaceId: 'ws-1',
          branch: 'main',
          displayName: 'repo-ws'
        }),
        listWorkspaces: async () => ({
          workspaces: [
            {
              id: 'ws-1',
              kind: 'worktree',
              name: 'repo-ws',
              path: wsDir,
              branch: 'main',
              hostId: 'local'
            }
          ]
        })
      }
    })

    // 1. Toggle user canonical-unindexed skill in project writeScope (default when workspace is open)
    const disableProj = await service.mutateEnablement({
      kind: 'disable',
      skillIds: ['rex'],
      writeScope: 'project',
      skillScope: 'user'
    })
    expect(disableProj.status).toBe('applied')
    expect(disableProj.failed).toEqual([])
    expect(disableProj.conflicts).toEqual([])
    expect(disableProj.updatedSkills[0]?.effective).toBe('disabled')
    expect(disableProj.updatedSkills[0]?.origin).toBe('project')
    expect(disableProj.updatedSkills[0]?.sourceKind).toBe('adopted')
    expect(await readFile(join(home, '.pmstudio', 'skills', 'rex', 'SKILL.md'), 'utf8')).toContain(
      'Canonical user skill'
    )

    const reEnableProj = await service.mutateEnablement({
      kind: 'enable',
      skillIds: ['rex'],
      writeScope: 'project',
      skillScope: 'user'
    })
    expect(reEnableProj.status).toBe('applied')
    expect(reEnableProj.updatedSkills[0]?.effective).toBe('enabled')

    // 2. Toggle user canonical-unindexed skill in user writeScope
    const disableUser = await service.mutateEnablement({
      kind: 'disable',
      skillIds: ['solo-user'],
      writeScope: 'user',
      skillScope: 'user'
    })
    expect(disableUser.status).toBe('applied')
    expect(disableUser.failed).toEqual([])
    expect(disableUser.updatedSkills[0]?.effective).toBe('disabled')
    expect(disableUser.updatedSkills[0]?.sourceKind).toBe('adopted')
    await expect(lstat(join(home, '.agents', 'skills', 'solo-user'))).rejects.toMatchObject({
      code: 'ENOENT'
    })

    const enableUser = await service.mutateEnablement({
      kind: 'enable',
      skillIds: ['solo-user'],
      writeScope: 'user',
      skillScope: 'user'
    })
    expect(enableUser.status).toBe('applied')
    expect(enableUser.updatedSkills[0]?.effective).toBe('enabled')

    // 3. Toggle workspace canonical-unindexed skill
    const disableWs = await service.mutateEnablement({
      kind: 'disable',
      skillIds: ['ws-canon'],
      writeScope: 'project',
      skillScope: 'workspace'
    })
    expect(disableWs.status).toBe('applied')
    expect(disableWs.failed).toEqual([])
    expect(disableWs.updatedSkills[0]?.effective).toBe('disabled')
    expect(disableWs.updatedSkills[0]?.sourceKind).toBe('adopted')

    // 4. Duplicate .agents/skills + .claude/skills triggers audit finding without undefined properties
    await createTestSkill(join(home, '.agents', 'skills'), 'dup-rex', 'Dup Rex', 'Duplicate')
    await createTestSkill(join(home, '.claude', 'skills'), 'dup-rex', 'Dup Rex', 'Duplicate')
    const audit = await service.runAudit('user')
    const dupFinding = audit.findings.find(
      (f) => f.kind === 'duplicate-same-digest' && f.skillId === 'dup-rex'
    )
    expect(dupFinding).toBeDefined()
    expect('agent' in dupFinding!).toBe(false)
    expect(audit).toStrictEqual(JSON.parse(JSON.stringify(audit)))
  })

  it('reports conflict or failed cleanly when canonical-unindexed skill cannot be adopted', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orca-worker-canon-fail-'))
    roots.push(home)
    await mkdir(join(home, '.agents', 'skills'), { recursive: true })
    await mkdir(join(home, '.claude', 'skills'), { recursive: true })

    // Conflicting digest between .agents/skills and .claude/skills
    await createTestSkill(join(home, '.agents', 'skills'), 'clash-skill', 'Clash', 'Variant A')
    await createTestSkill(join(home, '.claude', 'skills'), 'clash-skill', 'Clash', 'Variant B')

    // Internal symlink makes digest observation reject (skill-package-link)
    await createTestSkill(join(home, '.agents', 'skills'), 'link-skill', 'Link Skill', 'Has inner link')
    await symlink(
      join(home, '.agents', 'skills', 'clash-skill', 'SKILL.md'),
      join(home, '.agents', 'skills', 'link-skill', 'inner-link')
    )

    const service = new SkillsWorkerService({
      homeDirectory: home,
      etcCodexSkillsRoot: join(home, 'none-etc-codex'),
      hostBridge: {
        readWorkspaceContext: async () => null,
        listWorkspaces: async () => ({ workspaces: [] })
      }
    })

    const conflictRes = await service.mutateEnablement({
      kind: 'disable',
      skillIds: ['clash-skill'],
      writeScope: 'user',
      skillScope: 'user'
    })
    expect(conflictRes.status).toBe('conflict')
    expect(conflictRes.conflicts.some((c) => c.skillId === 'clash-skill')).toBe(true)
    expect(conflictRes.updatedSkills[0]?.effective).toBe('enabled')

    const failedRes = await service.mutateEnablement({
      kind: 'disable',
      skillIds: ['link-skill'],
      writeScope: 'user',
      skillScope: 'user'
    })
    expect(failedRes.status).toBe('conflict')
    expect(failedRes.failed.some((f) => f.skillId === 'link-skill')).toBe(true)
    expect(failedRes.updatedSkills[0]?.effective).toBe('enabled')
  })
})
