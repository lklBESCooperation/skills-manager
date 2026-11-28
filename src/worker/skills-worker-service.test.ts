import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SKILL_BRIDGE_METHODS,
  SkillAgentMatrixInputSchema,
  SkillMutateInputSchema
} from '../contracts/skill-ui-bridge-contract'
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
    for (const item of snap.managedSkills) {
      expect('agents' in item).toBe(false)
      expect('agentDetails' in item).toBe(false)
      expect(item.supportedAgentCount).toBeGreaterThan(0)
    }
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
    expect('agents' in perAgentRes.updatedSkills[0]!).toBe(false)
    expect('agentDetails' in perAgentRes.updatedSkills[0]!).toBe(false)
    expect(perAgentRes.updatedSkills[0]?.enabledAgentCount).toBe(0)

    const alphaMatrix = await service.getSkillAgentMatrix({
      skillId: 'alpha-skill',
      scope: 'user'
    })
    expect(alphaMatrix.rowKey).toBe('user:alpha-skill')
    expect(alphaMatrix.agents.claude).toBe(false)
    expect(alphaMatrix.agentDetails.claude?.origin).toBe('agent-override')
    expect(Object.keys(alphaMatrix.agents)).toHaveLength(45)
    expect(Object.keys(alphaMatrix.agentDetails)).toHaveLength(45)

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

  it('keeps workbench snapshot well under 1 MiB for 360+ skills and truncates long descriptions', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orca-worker-scale-'))
    roots.push(home)

    const userVault = join(home, '.pmstudio', 'skills')
    const claudeRoot = join(home, '.claude', 'skills')
    const codexSysRoot = join(home, '.codex', 'skills', '.system')
    await mkdir(userVault, { recursive: true })
    await mkdir(claudeRoot, { recursive: true })
    await mkdir(codexSysRoot, { recursive: true })

    const longDesc = 'Long skill description segment. '.repeat(35)
    expect(longDesc.length).toBeGreaterThan(1000)

    await Promise.all([
      ...Array.from({ length: 360 }, (_, idx) => {
        const id = `skill-${String(idx).padStart(3, '0')}`
        return createTestSkill(userVault, id, `Skill ${idx}`, longDesc)
      }),
      createTestSkill(claudeRoot, 'adopt-long', 'Adopt Long', longDesc),
      createTestSkill(codexSysRoot, 'plugin-long', 'Plugin Long', longDesc)
    ])

    const service = new SkillsWorkerService({
      homeDirectory: home,
      etcCodexSkillsRoot: join(home, 'none-etc-codex'),
      hostBridge: {
        readWorkspaceContext: async () => null,
        listWorkspaces: async () => ({ workspaces: [] })
      }
    })

    const snap = await service.getWorkbenchSnapshot()
    expect(snap.managedSkills).toHaveLength(360)
    for (const item of snap.managedSkills) {
      expect('agents' in item).toBe(false)
      expect('agentDetails' in item).toBe(false)
      expect(item.description).not.toBeNull()
      expect(item.description!.length).toBeLessThanOrEqual(300)
      expect(item.description!.endsWith('…')).toBe(true)
      expect(item.enabledAgentCount).toBe(item.supportedAgentCount)
    }

    expect(snap.adoptableSkills[0]?.description?.length).toBeLessThanOrEqual(300)
    expect(snap.adoptableSkills[0]?.description?.endsWith('…')).toBe(true)
    expect(snap.pluginSkills[0]?.description?.length).toBeLessThanOrEqual(300)
    expect(snap.pluginSkills[0]?.description?.endsWith('…')).toBe(true)

    const payloadBytes = Buffer.byteLength(JSON.stringify(snap), 'utf8')
    expect(payloadBytes).toBeLessThan(1_048_576)
    expect(payloadBytes).toBeLessThan(350_000)
  })

  it('serves full 45-agent matrix on demand via getSkillAgentMatrix and plugin-worker handler', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orca-worker-matrix-'))
    roots.push(home)

    const wsDir = join(home, 'repo-ws')
    await mkdir(join(home, '.pmstudio', 'skills'), { recursive: true })
    await mkdir(join(wsDir, '.pmstudio', 'skills'), { recursive: true })
    await createTestSkill(join(home, '.pmstudio', 'skills'), 'user-skill', 'User Skill', 'Global')
    await createTestSkill(join(wsDir, '.pmstudio', 'skills'), 'ws-skill', 'WS Skill', 'Workspace')

    let hasWorkspace = true
    const service = new SkillsWorkerService({
      homeDirectory: home,
      etcCodexSkillsRoot: join(home, 'none-etc-codex'),
      hostBridge: {
        readWorkspaceContext: async () =>
          hasWorkspace
            ? { workspaceId: 'ws-1', branch: 'main', displayName: 'repo-ws' }
            : null,
        listWorkspaces: async () => ({
          workspaces: hasWorkspace
            ? [
                {
                  id: 'ws-1',
                  kind: 'worktree',
                  name: 'repo-ws',
                  path: wsDir,
                  branch: 'main',
                  hostId: 'local'
                }
              ]
            : []
        })
      }
    })

    await service.mutateEnablement({
      kind: 'disable',
      skillIds: ['ws-skill'],
      writeScope: 'project',
      skillScope: 'workspace',
      agents: { claude: false }
    })

    const wsMatrix = await service.getSkillAgentMatrix({ skillId: 'ws-skill', scope: 'workspace' })
    expect(wsMatrix.rowKey).toBe('workspace:ws-skill')
    expect(Object.keys(wsMatrix.agents)).toHaveLength(45)
    expect(Object.keys(wsMatrix.agentDetails)).toHaveLength(45)
    expect(wsMatrix.agents.claude).toBe(false)
    expect(wsMatrix.agentDetails.claude?.origin).toBe('agent-override')
    expect(wsMatrix.agents.codex).toBe(true)

    await expect(
      service.getSkillAgentMatrix({ skillId: 'missing-skill', scope: 'user' })
    ).rejects.toThrow('skill-not-found: user:missing-skill')

    hasWorkspace = false
    await expect(
      service.getSkillAgentMatrix({ skillId: 'ws-skill', scope: 'workspace' })
    ).rejects.toThrow('skill-enablement-workspace-required')

    expect(() => SkillAgentMatrixInputSchema.parse({ skillId: '', scope: 'user' })).toThrow()
    expect(() => SkillAgentMatrixInputSchema.parse({ skillId: 'ok', scope: 'global' })).toThrow()

    const workerSpec = './plugin-worker.ts'
    const workerModule = (await import(workerSpec)) as {
      default: (orca: {
        host: { call: (m: string, p?: unknown) => Promise<unknown>; has: (m: string) => boolean }
        events: { on: (e: string, h: (p: unknown) => void) => { dispose: () => void } }
        panels: {
          handle: (
            n: string,
            h: (input: unknown) => Promise<unknown> | unknown
          ) => { dispose: () => void }
          post: (e: string, p?: unknown) => void
        }
      }) => () => void
    }
    const handlers = new Map<string, (input: unknown) => Promise<unknown> | unknown>()
    const dispose = workerModule.default({
      host: {
        call: async () => null,
        has: () => false
      },
      events: {
        on: () => ({ dispose: () => undefined })
      },
      panels: {
        handle: (name, handler) => {
          handlers.set(name, handler)
          return { dispose: () => undefined }
        },
        post: () => undefined
      }
    })

    try {
      const matrixHandler = handlers.get(SKILL_BRIDGE_METHODS.skillAgentMatrix)
      expect(matrixHandler).toBeDefined()
      await expect(matrixHandler!({ skillId: '', scope: 'user' })).rejects.toThrow()
    } finally {
      dispose()
    }
  })
})
