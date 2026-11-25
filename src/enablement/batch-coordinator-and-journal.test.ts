import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BatchCoordinator,
  InMemoryHierarchicalLockManager
} from './batch-coordinator'
import {
  applyPlanTransactionally,
  enablementJournalPath,
  recoverEnablementJournal,
  serializeJournalV2Chunks
} from './skill-enablement-journal'
import { planSkillEnablement } from './skill-enablement-planner'
import { fixtureSkillEnablementFileIO } from './skill-enablement-file-io.test-fixture'
import { resolveSkillProviderDestinations } from '../infra/skill-provider-destinations'
import {
  adoptSingleSkillUnit,
  nativeSkillVaultAdoptFilesystem
} from '../vault/skill-vault-adopt'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('BatchCoordinator & EnablementJournalV2', () => {
  it('isolates per-skill failures and skips busy/readonly/conflict items without aborting batch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-batch-'))
    roots.push(root)
    const home = join(root, 'home')
    const vaultRoot = join(home, '.pmstudio', 'skills')
    const claudeRoot = join(home, '.claude', 'skills')
    await mkdir(claudeRoot, { recursive: true })

    for (const id of ['a-ok', 'b-fail', 'c-ok']) {
      const dir = join(claudeRoot, id)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: ${id}\n---\n`)
    }

    const locks = new InMemoryHierarchicalLockManager()
    // Pre-hold lock on 'd-busy' so it reports skippedBusy without blocking other skills.
    const releaseBusy = await locks.tryAcquireSkillLock('global:d-busy', 100)
    const coordinator = new BatchCoordinator(locks)

    const report = await coordinator.executePerSkill({
      scopeKey: 'global',
      skillTimeoutMs: 25,
      items: [
        { id: 'c-ok', originPath: join(claudeRoot, 'c-ok') },
        { id: 'b-fail', originPath: join(claudeRoot, 'b-fail') },
        { id: 'a-ok', originPath: join(claudeRoot, 'a-ok') },
        { id: 'd-busy', originPath: join(claudeRoot, 'd-busy') },
        { id: 'e-conflict', originPath: join(claudeRoot, 'e-conflict'), conflict: true },
        { id: 'f-plugin', originPath: join(home, '.claude', 'plugins', 'f-plugin') }
      ],
      getSkillId: (item) => item.id,
      isConflict: (item) => Boolean(item.conflict),
      isReadonly: (item) => item.id === 'f-plugin',
      runItem: async (item) => {
        if (item.id === 'b-fail') {
          await adoptSingleSkillUnit({
            vaultRoot,
            item: { id: item.id, originPath: item.originPath, mergePaths: [] },
            copyMode: false,
            filesystem: {
              ...nativeSkillVaultAdoptFilesystem,
              symlink: async () => {
                throw new Error('skill-install-busy: simulated EBUSY')
              }
            }
          })
        }
        return adoptSingleSkillUnit({
          vaultRoot,
          item: { id: item.id, originPath: item.originPath, mergePaths: [] },
          copyMode: false
        })
      }
    })

    await releaseBusy?.()

    expect(report.succeeded.map((r) => r.id)).toEqual(['a-ok', 'c-ok'])
    expect(report.skippedBusy).toEqual(['d-busy'])
    expect(report.conflicts).toEqual(['e-conflict'])
    expect(report.skippedReadonly).toEqual(['f-plugin'])
    expect(report.failed).toHaveLength(1)
    expect(report.failed[0]?.skillId).toBe('b-fail')
    // Failed skill rolled back to its original location intact.
    expect(await readFile(join(claudeRoot, 'b-fail', 'SKILL.md'), 'utf8')).toContain('b-fail')
    await expect(realpath(join(vaultRoot, 'b-fail'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes chunked EnablementJournalV2 and replays multi-chunk crash recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-journal-v2-'))
    roots.push(root)
    const home = join(root, 'home')
    const vaultRoot = join(home, '.pmstudio', 'skills')
    const stateDir = join(home, '.pmstudio', 'state')
    const canonicalRoot = join(home, '.agents', 'skills')
    await mkdir(vaultRoot, { recursive: true })
    await mkdir(stateDir, { recursive: true })

    const skillIds = ['s1', 's2', 's3']
    for (const id of skillIds) {
      await mkdir(join(vaultRoot, id), { recursive: true })
      await writeFile(join(vaultRoot, id, 'SKILL.md'), `---\nname: ${id}\n---\n`)
    }

    const destinations = resolveSkillProviderDestinations({
      scope: 'global',
      homeDirectory: home,
      detectedProviders: ['claude', 'codex']
    })
    const plan = await planSkillEnablement({
      vaultRoot,
      installedSkillIds: skillIds,
      userDefaults: {},
      projectOverrides: {},
      destinations,
      canonicalRoot
    })

    const chunks = serializeJournalV2Chunks({
      actions: plan.actions.map((a) => ({
        kind: 'link' as const,
        skillId: a.observation.skillId,
        provider: a.observation.provider,
        sourcePath: join(vaultRoot, a.observation.skillId),
        destinationPath: join(a.observation.rootPath, a.observation.skillId)
      })),
      plan,
      vaultRoot,
      canonicalRoot,
      maxActionsPerChunk: 2
    })
    expect(chunks.length).toBe(3)
    expect(chunks[0]?.schemaVersion).toBe(2)

    await expect(
      applyPlanTransactionally({
        stateDirectory: stateDir,
        plan,
        vaultRoot,
        canonicalRoot,
        maxActionsPerChunk: 2,
        interruptAfterCount: 2
      })
    ).rejects.toThrow('skill-enablement-interrupted')

    const persistedChunk0 = JSON.parse(
      await readFile(enablementJournalPath(stateDir, 0), 'utf8')
    )
    expect(persistedChunk0.schemaVersion).toBe(2)
    expect(persistedChunk0.totalChunks).toBe(3)

    const recovered = await recoverEnablementJournal(
      stateDir,
      fixtureSkillEnablementFileIO().readFileBounded
    )
    expect(recovered.executed).toHaveLength(4)

    for (const id of skillIds) {
      const master = await realpath(join(vaultRoot, id))
      expect(await realpath(join(home, '.claude', 'skills', id))).toBe(master)
      expect(await realpath(join(home, '.agents', 'skills', id))).toBe(master)
    }
    await expect(realpath(enablementJournalPath(stateDir, 0))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
