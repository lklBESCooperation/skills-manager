import { lstat, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeSkillStateFile } from '../infra/skill-state-store'
import { renameSkillPathWithWindowsRetry } from '../infra/skill-filesystem-retry'
import { createNativeSkillAlias } from '../infra/skill-alias'
import type { SkillEnablementPlan } from './skill-enablement-planner'

const ENABLEMENT_JOURNAL_MAX_BYTES = 4 * 1024 * 1024

/** Host-injected bounded reader (upstream src/shared/node-bounded-file-reader); journal reads must cap bytes. */
export type EnablementBoundedFileReader = (
  filePath: string,
  maxBytes: number
) => Promise<{ buffer: Buffer }>

export type EnablementJournalAction = {
  kind: 'link' | 'unlink' | 'move-to-canonical' | 'move-to-vault'
  skillId: string
  provider: string
  sourcePath: string
  destinationPath: string
}

type EnablementJournalV1 = {
  schemaVersion: 1
  operation: 'enablement'
  phase: 'prepared' | 'executing' | 'settled'
  executedCount: number
  actions: EnablementJournalAction[]
}

export type ExecutedEnablementStep = {
  skillId: string
  provider: string
  action: string
}

export function enablementJournalPath(stateDirectory: string): string {
  return join(stateDirectory, 'enablement-journal.json')
}

async function pathExists(path: string): Promise<boolean> {
  return Boolean(await lstat(path).catch(() => null))
}

// Narrow unknown JSON to the journal shape; the single cast sits under a SAFETY directive.
function isEnablementJournalV1(value: unknown): value is EnablementJournalV1 {
  // SAFETY: field checks below cover every journal member before the shape is trusted.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: unknown JSON narrowed by the field checks that follow.
  const candidate = value as Partial<EnablementJournalV1>
  return (
    candidate?.schemaVersion === 1 &&
    candidate.operation === 'enablement' &&
    Array.isArray(candidate.actions)
  )
}

async function readEnablementJournal(
  stateDirectory: string,
  readFileBounded: EnablementBoundedFileReader
): Promise<EnablementJournalV1 | null> {
  try {
    const { buffer } = await readFileBounded(
      enablementJournalPath(stateDirectory),
      ENABLEMENT_JOURNAL_MAX_BYTES
    )
    const value: unknown = JSON.parse(buffer.toString('utf8'))
    return isEnablementJournalV1(value) ? value : null
  } catch {
    return null
  }
}

/** Every action is independently idempotent, so replaying the whole journal converges. */
async function executeEnablementAction(action: EnablementJournalAction): Promise<boolean> {
  switch (action.kind) {
    case 'link':
      if (await pathExists(action.destinationPath)) {
        return false
      }
      await createNativeSkillAlias(action.sourcePath, action.destinationPath)
      return true
    case 'unlink':
      if (!(await pathExists(action.destinationPath))) {
        return false
      }
      await rm(action.destinationPath, { recursive: true, force: true })
      return true
    case 'move-to-canonical':
    case 'move-to-vault':
      if ((await pathExists(action.destinationPath)) || !(await pathExists(action.sourcePath))) {
        return false
      }
      await mkdir(dirname(action.destinationPath), { recursive: true })
      await renameSkillPathWithWindowsRetry(action.sourcePath, action.destinationPath)
      return true
  }
}

/** Replay a journal left by an interrupted batch until every action lands or no-ops. */
export async function recoverEnablementJournal(
  stateDirectory: string,
  readFileBounded: EnablementBoundedFileReader
): Promise<{ executed: ExecutedEnablementStep[] }> {
  const journal = await readEnablementJournal(stateDirectory, readFileBounded)
  if (!journal) {
    return { executed: [] }
  }
  const executed: ExecutedEnablementStep[] = []
  for (const action of journal.actions) {
    if (await executeEnablementAction(action)) {
      executed.push({
        skillId: action.skillId,
        provider: action.provider,
        action: action.kind
      })
    }
  }
  await rm(enablementJournalPath(stateDirectory), { force: true })
  return { executed }
}

/** Moves run before links so link sources reflect the post-move master location. */
function actionOrderRank(kind: EnablementJournalAction['kind']): number {
  if (kind === 'move-to-canonical' || kind === 'move-to-vault') {
    return 0
  }
  return 1
}

export function journalActionsForPlan(
  plan: SkillEnablementPlan,
  vaultRoot: string,
  canonicalRoot: string
): EnablementJournalAction[] {
  const actions: EnablementJournalAction[] = []
  // The plan's end state decides link destinations: any canonical provider enabling in this
  // batch moves the master to canonical, so every link for that skill must target canonical.
  const canonicalEndState = new Set(
    plan.actions
      .filter((action) => action.kind === 'move-to-canonical')
      .map((action) => action.observation.skillId)
  )
  // Where the master lives right now (move source); never the planned end state.
  const masterNowAt = (skillId: string): string =>
    plan.masters[skillId]?.location === 'canonical'
      ? join(canonicalRoot, skillId)
      : join(vaultRoot, skillId)
  // Where links must point once this batch settles (move destination).
  const masterEndAt = (skillId: string): string =>
    canonicalEndState.has(skillId) || plan.masters[skillId]?.location === 'canonical'
      ? join(canonicalRoot, skillId)
      : join(vaultRoot, skillId)
  for (const action of plan.actions) {
    const observation = action.observation
    const destinationPath = join(observation.rootPath, observation.skillId)
    const vaultMaster = join(vaultRoot, observation.skillId)
    if (observation.readsCanonicalRoot) {
      if (action.kind === 'move-to-canonical') {
        actions.push({
          kind: 'move-to-canonical',
          skillId: observation.skillId,
          provider: observation.provider,
          sourcePath: masterNowAt(observation.skillId),
          destinationPath: join(canonicalRoot, observation.skillId)
        })
      } else if (action.kind === 'remove') {
        actions.push({
          kind: 'move-to-vault',
          skillId: observation.skillId,
          provider: observation.provider,
          sourcePath: destinationPath,
          destinationPath: vaultMaster
        })
      }
      continue
    }
    if (action.kind === 'add') {
      actions.push({
        kind: 'link',
        skillId: observation.skillId,
        provider: observation.provider,
        sourcePath: masterEndAt(observation.skillId),
        destinationPath
      })
    } else if (action.kind === 'remove') {
      actions.push({
        kind: 'unlink',
        skillId: observation.skillId,
        provider: observation.provider,
        sourcePath: masterEndAt(observation.skillId),
        destinationPath
      })
    }
  }
  return actions
}

/**
 * Journal-first placement batch: write every action before running any, run moves before
 * links, delete the journal once settled. An interruption leaves the journal so the next
 * run replays to convergence with no half-enabled state.
 */
export async function applyPlanTransactionally(input: {
  stateDirectory: string
  plan: SkillEnablementPlan
  vaultRoot: string
  canonicalRoot: string
  /** Test seam: crash after this many actions have run; the journal stays for replay. */
  interruptAfterCount?: number
}): Promise<ExecutedEnablementStep[]> {
  const actions = journalActionsForPlan(input.plan, input.vaultRoot, input.canonicalRoot)
  actions.sort((left, right) => actionOrderRank(left.kind) - actionOrderRank(right.kind))
  const journal: EnablementJournalV1 = {
    schemaVersion: 1,
    operation: 'enablement',
    phase: 'prepared',
    executedCount: 0,
    actions
  }
  await writeSkillStateFile(enablementJournalPath(input.stateDirectory), journal)
  journal.phase = 'executing'
  const executed: ExecutedEnablementStep[] = []
  for (const action of actions) {
    if (input.interruptAfterCount !== undefined && executed.length >= input.interruptAfterCount) {
      // Simulated power loss: leave the journal so the next run replays to convergence.
      throw new Error('skill-enablement-interrupted')
    }
    if (await executeEnablementAction(action)) {
      executed.push({
        skillId: action.skillId,
        provider: action.provider,
        action: action.kind
      })
    }
  }
  journal.phase = 'settled'
  journal.executedCount = executed.length
  await rm(enablementJournalPath(input.stateDirectory), { force: true })
  return executed
}
