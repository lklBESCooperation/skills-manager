import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
})
