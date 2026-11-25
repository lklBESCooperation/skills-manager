import { cp, lstat, mkdir, readlink, realpath, rm, symlink } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { assertWritableSkillTarget } from '../infra/readonly-root-fence'
import { renameSkillPathWithWindowsRetry } from '../infra/skill-filesystem-retry'
import { writeSkillStateFile } from '../infra/skill-state-store'
import { createNativeSkillAlias } from '../infra/skill-alias'
import type { SkillEnablementPlan } from './skill-enablement-planner'

const ENABLEMENT_JOURNAL_MAX_BYTES = 4 * 1024 * 1024
export const MAX_JOURNAL_ACTIONS = 2_000

/** Host-injected bounded reader (upstream src/shared/node-bounded-file-reader); journal reads must cap bytes. */
export type EnablementBoundedFileReader = (
  filePath: string,
  maxBytes: number
) => Promise<{ buffer: Buffer }>

export type EnablementJournalAction = {
  kind: 'link' | 'unlink' | 'copy' | 'remove-copy' | 'adopt-canonical-to-vault'
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
  actions: {
    kind: 'link' | 'unlink' | 'move-to-canonical' | 'move-to-vault'
    skillId: string
    provider: string
    sourcePath: string
    destinationPath: string
  }[]
}

/**
 * Compact chunked Journal V2 (Architect §3.3 / Q5):
 * Root path dictionary avoids repeating long directories across thousands of tuples.
 */
export type EnablementJournalTupleOp = 'L' | 'U' | 'C' | 'R' | 'M'

export type EnablementJournalV2 = {
  schemaVersion: 2
  operation: 'enablement'
  vaultRoot: string
  canonicalRoot: string
  chunkIndex: number
  totalChunks: number
  providerRoots: Record<string, string>
  tuples: [op: EnablementJournalTupleOp, skillId: string, providerKey: string][]
}

export type ExecutedEnablementStep = {
  skillId: string
  provider: string
  action: string
}

export function enablementJournalPath(stateDirectory: string, chunkIndex = 0): string {
  return chunkIndex === 0
    ? join(stateDirectory, 'enablement-journal.json')
    : join(stateDirectory, `enablement-journal.chunk-${chunkIndex}.json`)
}

async function pathExists(path: string): Promise<boolean> {
  return Boolean(await lstat(path).catch(() => null))
}

function isEnablementJournalV1(value: unknown): value is EnablementJournalV1 {
  const candidate = value as Partial<EnablementJournalV1>
  return (
    candidate?.schemaVersion === 1 &&
    candidate.operation === 'enablement' &&
    Array.isArray(candidate.actions)
  )
}

function isEnablementJournalV2(value: unknown): value is EnablementJournalV2 {
  const candidate = value as Partial<EnablementJournalV2>
  return (
    candidate?.schemaVersion === 2 &&
    candidate.operation === 'enablement' &&
    typeof candidate.vaultRoot === 'string' &&
    typeof candidate.canonicalRoot === 'string' &&
    typeof candidate.providerRoots === 'object' &&
    candidate.providerRoots !== null &&
    Array.isArray(candidate.tuples)
  )
}

async function readJournalEnvelope(
  filePath: string,
  readFileBounded: EnablementBoundedFileReader
): Promise<EnablementJournalV1 | EnablementJournalV2 | null> {
  try {
    const { buffer } = await readFileBounded(filePath, ENABLEMENT_JOURNAL_MAX_BYTES)
    const value: unknown = JSON.parse(buffer.toString('utf8'))
    if (isEnablementJournalV2(value)) {
      return value
    }
    if (isEnablementJournalV1(value)) {
      return value
    }
    return null
  } catch {
    return null
  }
}

function opCodeToKind(op: EnablementJournalTupleOp): EnablementJournalAction['kind'] {
  switch (op) {
    case 'L':
      return 'link'
    case 'U':
      return 'unlink'
    case 'C':
      return 'copy'
    case 'R':
      return 'remove-copy'
    case 'M':
      return 'adopt-canonical-to-vault'
  }
}

function kindToOpCode(kind: EnablementJournalAction['kind']): EnablementJournalTupleOp {
  switch (kind) {
    case 'link':
      return 'L'
    case 'unlink':
      return 'U'
    case 'copy':
      return 'C'
    case 'remove-copy':
      return 'R'
    case 'adopt-canonical-to-vault':
      return 'M'
  }
}

function expandJournalV2(journal: EnablementJournalV2): EnablementJournalAction[] {
  return journal.tuples.flatMap<EnablementJournalAction>(([op, skillId, providerKey]) => {
    const rootPath = journal.providerRoots[providerKey]
    if (!rootPath) {
      return []
    }
    const kind = opCodeToKind(op)
    const vaultMaster = join(journal.vaultRoot, skillId)
    if (kind === 'adopt-canonical-to-vault') {
      return [
        {
          kind,
          skillId,
          provider: providerKey,
          sourcePath: join(journal.canonicalRoot, skillId),
          destinationPath: vaultMaster
        }
      ]
    }
    return [
      {
        kind,
        skillId,
        provider: providerKey,
        sourcePath: vaultMaster,
        destinationPath: join(rootPath, skillId)
      }
    ]
  })
}

async function adoptCanonicalEntryToVault(
  canonicalPath: string,
  vaultPath: string
): Promise<boolean> {
  if ((await pathExists(vaultPath)) || !(await pathExists(canonicalPath))) {
    return false
  }
  await mkdir(dirname(vaultPath), { recursive: true })
  const entryStat = await lstat(canonicalPath)
  if (entryStat.isSymbolicLink()) {
    // Preserve external library link inside Vault without touching the library itself.
    const rawTarget = await readlink(canonicalPath)
    const resolvedTarget = await realpath(canonicalPath).catch(() =>
      resolve(dirname(canonicalPath), rawTarget)
    )
    if (process.platform === 'win32') {
      await symlink(resolvedTarget, vaultPath, 'junction')
    } else {
      const realVaultParent = await realpath(dirname(vaultPath)).catch(() =>
        resolve(dirname(vaultPath))
      )
      await symlink(relative(realVaultParent, resolvedTarget), vaultPath, 'dir')
    }
    await rm(canonicalPath, { recursive: true, force: true })
    return true
  }
  await renameSkillPathWithWindowsRetry(canonicalPath, vaultPath)
  return true
}

/** Every action is independently idempotent, so replaying the whole journal converges. */
async function executeEnablementAction(
  action: EnablementJournalAction,
  readonlyRoots?: readonly string[]
): Promise<boolean> {
  await assertWritableSkillTarget(action.destinationPath, { readonlyRoots })
  switch (action.kind) {
    case 'adopt-canonical-to-vault':
      return adoptCanonicalEntryToVault(action.sourcePath, action.destinationPath)
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
    case 'copy':
      await rm(action.destinationPath, { recursive: true, force: true }).catch(() => undefined)
      await mkdir(dirname(action.destinationPath), { recursive: true })
      await cp(action.sourcePath, action.destinationPath, { recursive: true, verbatimSymlinks: true })
      return true
    case 'remove-copy':
      if (!(await pathExists(action.destinationPath))) {
        return false
      }
      await rm(action.destinationPath, { recursive: true, force: true })
      return true
  }
}

async function executeLegacyV1Action(
  action: EnablementJournalV1['actions'][number],
  readonlyRoots?: readonly string[]
): Promise<boolean> {
  await assertWritableSkillTarget(action.destinationPath, { readonlyRoots })
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

/** Replay any journal (v1 or multi-chunk v2) left by an interrupted batch until convergence. */
export async function recoverEnablementJournal(
  stateDirectory: string,
  readFileBounded: EnablementBoundedFileReader,
  readonlyRoots?: readonly string[]
): Promise<{ executed: ExecutedEnablementStep[] }> {
  const executed: ExecutedEnablementStep[] = []
  const primaryPath = enablementJournalPath(stateDirectory, 0)
  const first = await readJournalEnvelope(primaryPath, readFileBounded)
  if (!first) {
    return { executed }
  }

  if (first.schemaVersion === 1) {
    for (const action of first.actions) {
      if (await executeLegacyV1Action(action, readonlyRoots)) {
        executed.push({
          skillId: action.skillId,
          provider: action.provider,
          action: action.kind
        })
      }
    }
    await rm(primaryPath, { force: true })
    return { executed }
  }

  const totalChunks = Math.max(1, first.totalChunks || 1)
  const chunkPaths: string[] = [primaryPath]
  const journals: EnablementJournalV2[] = [first]
  for (let i = 1; i < totalChunks; i += 1) {
    const chunkPath = enablementJournalPath(stateDirectory, i)
    const next = await readJournalEnvelope(chunkPath, readFileBounded)
    if (next && next.schemaVersion === 2) {
      chunkPaths.push(chunkPath)
      journals.push(next)
    }
  }

  for (const chunk of journals) {
    for (const action of expandJournalV2(chunk)) {
      if (await executeEnablementAction(action, readonlyRoots)) {
        executed.push({
          skillId: action.skillId,
          provider: action.provider,
          action: action.kind
        })
      }
    }
  }

  for (const chunkPath of chunkPaths) {
    await rm(chunkPath, { force: true }).catch(() => undefined)
  }
  return { executed }
}

function actionOrderRank(kind: EnablementJournalAction['kind']): number {
  if (kind === 'adopt-canonical-to-vault') {
    return 0
  }
  if (kind === 'unlink' || kind === 'remove-copy') {
    return 1
  }
  return 2
}

export function journalActionsForPlan(
  plan: SkillEnablementPlan,
  vaultRoot: string,
  canonicalRoot: string
): EnablementJournalAction[] {
  const actions: EnablementJournalAction[] = []
  for (const action of plan.actions) {
    const observation = action.observation
    const destinationPath = join(observation.rootPath, observation.skillId)
    const vaultMaster = join(vaultRoot, observation.skillId)

    if (action.kind === 'adopt-canonical-to-vault') {
      actions.push({
        kind: 'adopt-canonical-to-vault',
        skillId: observation.skillId,
        provider: observation.provider,
        sourcePath: join(canonicalRoot, observation.skillId),
        destinationPath: vaultMaster
      })
      continue
    }
    if (action.kind === 'add') {
      actions.push({
        kind: action.copyMode ? 'copy' : 'link',
        skillId: observation.skillId,
        provider: observation.provider,
        sourcePath: vaultMaster,
        destinationPath
      })
      continue
    }
    if (action.kind === 'refresh-copy') {
      actions.push({
        kind: 'copy',
        skillId: observation.skillId,
        provider: observation.provider,
        sourcePath: vaultMaster,
        destinationPath
      })
      continue
    }
    if (action.kind === 'remove') {
      actions.push({
        kind: action.copyMode ? 'remove-copy' : 'unlink',
        skillId: observation.skillId,
        provider: observation.provider,
        sourcePath: vaultMaster,
        destinationPath
      })
    }
  }
  return actions
}

export function serializeJournalV2Chunks(input: {
  actions: readonly EnablementJournalAction[]
  plan: SkillEnablementPlan
  vaultRoot: string
  canonicalRoot: string
  maxActionsPerChunk?: number
}): EnablementJournalV2[] {
  const maxPerChunk = Math.max(1, input.maxActionsPerChunk ?? MAX_JOURNAL_ACTIONS)
  const providerRoots: Record<string, string> = {}
  for (const action of input.plan.actions) {
    providerRoots[action.observation.provider] = action.observation.rootPath
  }
  const allTuples: EnablementJournalV2['tuples'] = input.actions.map((action) => [
    kindToOpCode(action.kind),
    action.skillId,
    action.provider
  ])
  if (allTuples.length === 0) {
    return [
      {
        schemaVersion: 2,
        operation: 'enablement',
        vaultRoot: input.vaultRoot,
        canonicalRoot: input.canonicalRoot,
        chunkIndex: 0,
        totalChunks: 1,
        providerRoots,
        tuples: []
      }
    ]
  }

  const totalChunks = Math.ceil(allTuples.length / maxPerChunk)
  const chunks: EnablementJournalV2[] = []
  for (let i = 0; i < totalChunks; i += 1) {
    chunks.push({
      schemaVersion: 2,
      operation: 'enablement',
      vaultRoot: input.vaultRoot,
      canonicalRoot: input.canonicalRoot,
      chunkIndex: i,
      totalChunks,
      providerRoots,
      tuples: allTuples.slice(i * maxPerChunk, (i + 1) * maxPerChunk)
    })
  }
  return chunks
}

/**
 * Journal-first placement batch using compact chunked EnablementJournalV2:
 * writes every chunk before executing any action, runs Vault migrations before links,
 * and deletes the journal once settled.
 */
export async function applyPlanTransactionally(input: {
  stateDirectory: string
  plan: SkillEnablementPlan
  vaultRoot: string
  canonicalRoot: string
  readonlyRoots?: readonly string[]
  maxActionsPerChunk?: number
  /** Test seam: crash after this many actions have run; the journal stays for replay. */
  interruptAfterCount?: number
}): Promise<ExecutedEnablementStep[]> {
  const actions = journalActionsForPlan(input.plan, input.vaultRoot, input.canonicalRoot)
  actions.sort((left, right) => actionOrderRank(left.kind) - actionOrderRank(right.kind))

  const chunks = serializeJournalV2Chunks({
    actions,
    plan: input.plan,
    vaultRoot: input.vaultRoot,
    canonicalRoot: input.canonicalRoot,
    maxActionsPerChunk: input.maxActionsPerChunk
  })
  const chunkPaths = chunks.map((_, index) => enablementJournalPath(input.stateDirectory, index))
  for (let i = 0; i < chunks.length; i += 1) {
    await writeSkillStateFile(chunkPaths[i], chunks[i])
  }

  const executed: ExecutedEnablementStep[] = []
  for (const action of actions) {
    if (input.interruptAfterCount !== undefined && executed.length >= input.interruptAfterCount) {
      throw new Error('skill-enablement-interrupted')
    }
    if (await executeEnablementAction(action, input.readonlyRoots)) {
      executed.push({
        skillId: action.skillId,
        provider: action.provider,
        action: action.kind
      })
    }
  }
  for (const chunkPath of chunkPaths) {
    await rm(chunkPath, { force: true }).catch(() => undefined)
  }
  return executed
}
