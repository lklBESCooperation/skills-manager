import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, realpath, rm, stat, symlink } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import {
  classifyCopyModePlacement,
  type ManagedPlacementRecord,
  type SkillVaultIndex
} from '../contracts/skill-vault-contract'
import { summarizeSkillMarkdown } from '../contracts/skill-metadata'
import { nativeSkillPathSemantics, normalizedSkillPath } from '../contracts/skill-path-containment'
import { assertWritableSkillTarget } from '../infra/readonly-root-fence'
import { renameSkillPathWithWindowsRetry } from '../infra/skill-filesystem-retry'
import { SKILL_VAULT_STAGE_MARKER } from './staging-marker'
import {
  computeSkillVaultDigest,
  detectSkillVaultCopyMode,
  rebuildSkillVaultIndex,
  readSkillVaultIndex,
  skillVaultSizeBytes
} from './skill-vault-index-service'
import { skillVaultEntryRoot } from './skill-vault-paths'

export type SkillVaultAdoptOutcome = {
  adopted: { id: string; vaultPath: string; originPath: string; merged: string[] }[]
  copyMode: boolean
  index: SkillVaultIndex
}

export type SkillVaultAdoptItemInput = {
  id: string
  originPath: string
  mergePaths: readonly string[]
}

export type SkillVaultAdoptFilesystem = {
  mkdir(path: string): Promise<void>
  rename(source: string, target: string): Promise<void>
  remove(path: string): Promise<void>
  symlink(target: string, path: string, kind: 'dir' | 'junction'): Promise<void>
  copyTree(source: string, target: string): Promise<void>
  readFile(path: string): Promise<string>
  lstat(path: string): Promise<{ isSymbolicLink(): boolean } | null>
}

export const nativeSkillVaultAdoptFilesystem: SkillVaultAdoptFilesystem = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  rename: renameSkillPathWithWindowsRetry,
  remove: (path) => rm(path, { recursive: true, force: true }),
  symlink: (target, path, kind) => symlink(target, path, kind),
  copyTree: (source, target) => cp(source, target, { recursive: true, verbatimSymlinks: true }),
  readFile: (path) => readFile(path, 'utf8'),
  lstat: (path) => lstat(path).catch(() => null)
}

function stagePathFor(target: string): string {
  return join(dirname(target), `.${basename(target)}${SKILL_VAULT_STAGE_MARKER}${randomUUID()}`)
}

/** Windows needs no privilege for junctions; POSIX gets a relative dir link. */
async function createVaultLink(
  vaultPath: string,
  originPath: string,
  filesystem: SkillVaultAdoptFilesystem
): Promise<void> {
  await filesystem.mkdir(dirname(originPath))
  if (process.platform === 'win32') {
    await filesystem.symlink(resolve(vaultPath), originPath, 'junction')
    return
  }
  const realOriginParent = await realpath(dirname(originPath)).catch(() =>
    resolve(dirname(originPath))
  )
  const realVaultPath = await realpath(vaultPath).catch(() => resolve(vaultPath))
  await filesystem.symlink(relative(realOriginParent, realVaultPath), originPath, 'dir')
}

export type AdoptedRecord = {
  id: string
  vaultPath: string
  originPath: string
  mergePaths: string[]
  digest: string
  name: string
  description: string | null
  sizeBytes: number
  installedAt: string
  managedPlacements: Record<string, ManagedPlacementRecord>
}

/**
 * Single-skill atomic adoption unit: stages, moves primary into Vault, links/copies origins,
 * and rolls back ONLY this skill if any step fails.
 */
export async function adoptSingleSkillUnit(input: {
  vaultRoot: string
  item: SkillVaultAdoptItemInput
  copyMode: boolean
  installedAt?: string
  readonlyRoots?: readonly string[]
  filesystem?: SkillVaultAdoptFilesystem
}): Promise<AdoptedRecord> {
  const filesystem = input.filesystem ?? nativeSkillVaultAdoptFilesystem
  const semantics = nativeSkillPathSemantics()
  const { item } = input
  const allOrigins = [item.originPath, ...item.mergePaths]
  for (const origin of allOrigins) {
    await assertWritableSkillTarget(origin, { readonlyRoots: input.readonlyRoots, semantics })
  }
  const vaultPath = skillVaultEntryRoot(input.vaultRoot, item.id)
  await assertWritableSkillTarget(vaultPath, { readonlyRoots: input.readonlyRoots, semantics })

  const staged = new Map<string, string>()
  let movedToVault = false
  const linked: string[] = []

  const rollback = async (): Promise<void> => {
    for (const originPath of linked.toReversed()) {
      await filesystem.remove(originPath).catch(() => undefined)
    }
    if (movedToVault) {
      await filesystem.rename(vaultPath, item.originPath).catch(() => undefined)
    }
    for (const [originPath, stagePath] of [...staged.entries()].toReversed()) {
      if (!(movedToVault && originPath === item.originPath)) {
        await filesystem.rename(stagePath, originPath).catch(() => undefined)
      }
      await filesystem.remove(stagePath).catch(() => undefined)
    }
  }

  try {
    for (const originPath of allOrigins) {
      const stagePath = stagePathFor(originPath)
      await filesystem.rename(originPath, stagePath)
      staged.set(originPath, stagePath)
    }

    const primaryStage = staged.get(item.originPath)
    if (!primaryStage) {
      throw new Error(`skill-vault-missing-stage: ${item.id}`)
    }
    await filesystem.mkdir(dirname(vaultPath))
    await filesystem.rename(primaryStage, vaultPath)
    movedToVault = true

    for (const originPath of allOrigins) {
      if (input.copyMode) {
        await filesystem.copyTree(vaultPath, originPath)
      } else {
        await createVaultLink(vaultPath, originPath, filesystem)
      }
      linked.push(originPath)
    }

    // Clean up duplicate merge staging dirs only after links/copies succeed.
    for (const mergePath of item.mergePaths) {
      const mergeStage = staged.get(mergePath)
      if (mergeStage) {
        await filesystem.remove(mergeStage).catch(() => undefined)
      }
    }

    const markdown = await filesystem.readFile(join(vaultPath, 'SKILL.md')).catch(() => '')
    const summary = summarizeSkillMarkdown(markdown)
    const digest = await computeSkillVaultDigest(vaultPath)
    const sizeBytes = await skillVaultSizeBytes(vaultPath).catch(() => 0)
    const now = new Date().toISOString()

    const managedPlacements: Record<string, ManagedPlacementRecord> = {}
    const topology = input.copyMode
      ? 'copy'
      : process.platform === 'win32'
        ? 'junction'
        : 'symlink'
    for (const originPath of allOrigins) {
      const originStat = await stat(originPath).catch(() => null)
      managedPlacements[normalizedSkillPath(originPath, semantics)] = {
        topology,
        syncedDigest: digest,
        ...(originStat ? { syncedMtimeMs: originStat.mtimeMs } : {})
      }
    }

    return {
      id: item.id,
      vaultPath,
      originPath: item.originPath,
      mergePaths: [...item.mergePaths],
      digest,
      name: summary.name ?? item.id,
      description: summary.description,
      sizeBytes,
      installedAt: input.installedAt ?? now,
      managedPlacements
    }
  } catch (error) {
    await rollback()
    throw error
  }
}

/** Batch-atomic adopt (legacy contract preserved: any failure rolls back all items in the batch). */
export async function adoptSkillsIntoVault(input: {
  homeDirectory: string
  vaultRoot: string
  indexPath: string
  items: readonly SkillVaultAdoptItemInput[]
  readonlyRoots?: readonly string[]
  filesystem?: SkillVaultAdoptFilesystem
}): Promise<SkillVaultAdoptOutcome> {
  const filesystem = input.filesystem ?? nativeSkillVaultAdoptFilesystem
  const semantics = nativeSkillPathSemantics()
  for (const item of input.items) {
    for (const origin of [item.originPath, ...item.mergePaths]) {
      await assertWritableSkillTarget(origin, { readonlyRoots: input.readonlyRoots, semantics })
    }
  }
  const copyMode = await detectSkillVaultCopyMode(input.vaultRoot)
  await filesystem.mkdir(input.vaultRoot)

  const staged = new Map<string, string>()
  const movedToVault = new Map<string, string>()
  const linked: string[] = []

  const rollback = async (): Promise<void> => {
    for (const originPath of linked.toReversed()) {
      await filesystem.remove(originPath).catch(() => undefined)
    }
    for (const [originPath, vaultPath] of [...movedToVault.entries()].toReversed()) {
      await filesystem.rename(vaultPath, originPath).catch(() => undefined)
    }
    for (const [originPath, stagePath] of [...staged.entries()].toReversed()) {
      if (!movedToVault.has(originPath)) {
        await filesystem.rename(stagePath, originPath).catch(() => undefined)
      }
      await filesystem.remove(stagePath).catch(() => undefined)
    }
  }

  try {
    for (const item of input.items) {
      for (const originPath of [item.originPath, ...item.mergePaths]) {
        const stagePath = stagePathFor(originPath)
        await filesystem.rename(originPath, stagePath)
        staged.set(originPath, stagePath)
      }
    }

    for (const item of input.items) {
      const stagePath = staged.get(item.originPath)
      if (!stagePath) {
        continue
      }
      const vaultPath = skillVaultEntryRoot(input.vaultRoot, item.id)
      await filesystem.mkdir(dirname(vaultPath))
      await filesystem.rename(stagePath, vaultPath)
      movedToVault.set(item.originPath, vaultPath)
    }

    for (const item of input.items) {
      const vaultPath = skillVaultEntryRoot(input.vaultRoot, item.id)
      for (const originPath of [item.originPath, ...item.mergePaths]) {
        const placeLink = copyMode
          ? filesystem.copyTree(vaultPath, originPath)
          : createVaultLink(vaultPath, originPath, filesystem)
        await placeLink
        linked.push(originPath)
      }
    }

    for (const item of input.items) {
      for (const mergePath of item.mergePaths) {
        const mergeStage = staged.get(mergePath)
        if (mergeStage) {
          await filesystem.remove(mergeStage).catch(() => undefined)
        }
      }
    }

    const previous = await readSkillVaultIndex(input.indexPath)
    const now = new Date().toISOString()
    const records: AdoptedRecord[] = []
    const topology = copyMode
      ? 'copy'
      : process.platform === 'win32'
        ? 'junction'
        : 'symlink'

    for (const item of input.items) {
      const vaultPath = skillVaultEntryRoot(input.vaultRoot, item.id)
      const markdown = await filesystem.readFile(join(vaultPath, 'SKILL.md')).catch(() => '')
      const summary = summarizeSkillMarkdown(markdown)
      const digest = await computeSkillVaultDigest(vaultPath)
      const managedPlacements: Record<string, ManagedPlacementRecord> = {}
      for (const originPath of [item.originPath, ...item.mergePaths]) {
        const originStat = await stat(originPath).catch(() => null)
        managedPlacements[normalizedSkillPath(originPath, semantics)] = {
          topology,
          syncedDigest: digest,
          ...(originStat ? { syncedMtimeMs: originStat.mtimeMs } : {})
        }
      }
      records.push({
        id: item.id,
        vaultPath,
        originPath: item.originPath,
        mergePaths: [...item.mergePaths],
        digest,
        name: summary.name ?? item.id,
        description: summary.description,
        sizeBytes: await skillVaultSizeBytes(vaultPath).catch(() => 0),
        installedAt: previous?.entries.find((entry) => entry.id === item.id)?.installedAt ?? now,
        managedPlacements
      })
    }

    const retained = (previous?.entries ?? []).filter(
      (entry) => !records.some((record) => record.id === entry.id)
    )
    const entries = [
      ...retained,
      ...records.map((record) => toIndexEntry(record, now, copyMode))
    ].sort((left, right) => left.id.localeCompare(right.id))
    return {
      adopted: records.map((record) => ({
        id: record.id,
        vaultPath: record.vaultPath,
        originPath: record.originPath,
        merged: record.mergePaths
      })),
      copyMode,
      index: await rebuildSkillVaultIndex(input.indexPath, entries)
    }
  } catch (error) {
    await rollback()
    throw error
  }
}

export function toIndexEntry(
  record: AdoptedRecord,
  now: string,
  copyMode: boolean
): SkillVaultIndex['entries'][number] {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    sourceKind: 'adopted',
    originPath: record.originPath,
    linkPaths: [record.originPath, ...record.mergePaths],
    digest: record.digest,
    sizeBytes: record.sizeBytes,
    tags: [],
    author: null,
    installedAt: record.installedAt,
    updatedAt: now,
    ...(copyMode ? { copyMode: true } : {}),
    ...(Object.keys(record.managedPlacements).length > 0
      ? { managedPlacements: record.managedPlacements }
      : {})
  }
}

/** Promote a drifted copyMode placement into Vault (updating Vault master & syncedDigest). */
export async function promoteCopyModeToVault(input: {
  vaultRoot: string
  indexPath: string
  id: string
  placementPath: string
  readonlyRoots?: readonly string[]
}): Promise<SkillVaultIndex> {
  const semantics = nativeSkillPathSemantics()
  await assertWritableSkillTarget(input.placementPath, {
    readonlyRoots: input.readonlyRoots,
    semantics
  })
  const vaultPath = skillVaultEntryRoot(input.vaultRoot, input.id)
  await assertWritableSkillTarget(vaultPath, { readonlyRoots: input.readonlyRoots, semantics })

  const index = await readSkillVaultIndex(input.indexPath)
  const entry = index?.entries.find((item) => item.id === input.id)
  if (!entry) {
    throw new Error(`skill-vault-unknown-entry: ${input.id}`)
  }

  const stage = stagePathFor(vaultPath)
  await cp(input.placementPath, stage, { recursive: true, verbatimSymlinks: true })
  const backup = stagePathFor(vaultPath)
  await renameSkillPathWithWindowsRetry(vaultPath, backup)
  try {
    await renameSkillPathWithWindowsRetry(stage, vaultPath)
    await rm(backup, { recursive: true, force: true }).catch(() => undefined)
  } catch (error) {
    await renameSkillPathWithWindowsRetry(backup, vaultPath).catch(() => undefined)
    await rm(stage, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }

  const newDigest = await computeSkillVaultDigest(vaultPath)
  const newSize = await skillVaultSizeBytes(vaultPath).catch(() => entry.sizeBytes)
  const markdown = await readFile(join(vaultPath, 'SKILL.md'), 'utf8').catch(() => '')
  const summary = summarizeSkillMarkdown(markdown)
  const placementKey = normalizedSkillPath(input.placementPath, semantics)
  const placementStat = await stat(input.placementPath).catch(() => null)
  const updatedEntries = index!.entries.map((item) =>
    item.id !== input.id
      ? item
      : {
          ...item,
          name: summary.name ?? item.name,
          description: summary.description,
          digest: newDigest,
          sizeBytes: newSize,
          updatedAt: new Date().toISOString(),
          managedPlacements: {
            ...(item.managedPlacements ?? {}),
            [placementKey]: {
              topology: 'copy' as const,
              syncedDigest: newDigest,
              ...(placementStat ? { syncedMtimeMs: placementStat.mtimeMs } : {})
            }
          }
        }
  )
  return rebuildSkillVaultIndex(input.indexPath, updatedEntries)
}

/** Reset a drifted/outdated copyMode placement from the authoritative Vault master. */
export async function resetCopyModeFromVault(input: {
  vaultRoot: string
  indexPath: string
  id: string
  placementPath: string
  readonlyRoots?: readonly string[]
}): Promise<SkillVaultIndex> {
  const semantics = nativeSkillPathSemantics()
  await assertWritableSkillTarget(input.placementPath, {
    readonlyRoots: input.readonlyRoots,
    semantics
  })
  const vaultPath = skillVaultEntryRoot(input.vaultRoot, input.id)
  const index = await readSkillVaultIndex(input.indexPath)
  const entry = index?.entries.find((item) => item.id === input.id)
  if (!entry) {
    throw new Error(`skill-vault-unknown-entry: ${input.id}`)
  }

  const stage = stagePathFor(input.placementPath)
  await cp(vaultPath, stage, { recursive: true, verbatimSymlinks: true })
  await rm(input.placementPath, { recursive: true, force: true })
  await renameSkillPathWithWindowsRetry(stage, input.placementPath)

  const vaultDigest = await computeSkillVaultDigest(vaultPath)
  const placementKey = normalizedSkillPath(input.placementPath, semantics)
  const placementStat = await stat(input.placementPath).catch(() => null)
  const updatedEntries = index!.entries.map((item) =>
    item.id !== input.id
      ? item
      : {
          ...item,
          digest: vaultDigest,
          updatedAt: new Date().toISOString(),
          managedPlacements: {
            ...(item.managedPlacements ?? {}),
            [placementKey]: {
              topology: 'copy' as const,
              syncedDigest: vaultDigest,
              ...(placementStat ? { syncedMtimeMs: placementStat.mtimeMs } : {})
            }
          }
        }
  )
  return rebuildSkillVaultIndex(input.indexPath, updatedEntries)
}

/** Cancel management for one entry: move the primary back and drop its links. */
export async function unadoptSkillFromVault(input: {
  vaultRoot: string
  indexPath: string
  id: string
  /** Additional link locations to clear beyond the recorded origin. */
  extraLinkPaths?: readonly string[]
  readonlyRoots?: readonly string[]
  force?: boolean
  filesystem?: SkillVaultAdoptFilesystem
}): Promise<{ originPath: string }> {
  const filesystem = input.filesystem ?? nativeSkillVaultAdoptFilesystem
  const semantics = nativeSkillPathSemantics()
  const index = await readSkillVaultIndex(input.indexPath)
  const entry = index?.entries.find((candidate) => candidate.id === input.id)
  if (!entry) {
    throw new Error(`skill-vault-unknown-entry: ${input.id}`)
  }
  const vaultPath = skillVaultEntryRoot(input.vaultRoot, input.id)
  const originPath = entry.originPath ?? join(dirname(vaultPath), 'restored', input.id)
  await assertWritableSkillTarget(originPath, { readonlyRoots: input.readonlyRoots, semantics })

  const linkPaths = [
    ...new Set([originPath, ...(entry.linkPaths ?? []), ...(input.extraLinkPaths ?? [])])
  ]
  for (const linkPath of linkPaths) {
    await assertWritableSkillTarget(linkPath, { readonlyRoots: input.readonlyRoots, semantics })
  }

  const removed: string[] = []
  try {
    await filesystem.mkdir(dirname(originPath))
    for (const linkPath of linkPaths) {
      const linkStat = await filesystem.lstat(linkPath)
      if (!linkStat) {
        continue
      }
      if (linkStat.isSymbolicLink()) {
        await filesystem.remove(linkPath)
        removed.push(linkPath)
        continue
      }
      // In copyMode, protect drifted local edits unless explicitly forced.
      const placement = entry.managedPlacements?.[normalizedSkillPath(linkPath, semantics)]
      if (placement?.topology === 'copy') {
        const observedDigest = await computeSkillVaultDigest(linkPath).catch(() => null)
        const state = classifyCopyModePlacement({
          vaultDigest: entry.digest,
          observedDigest,
          placement
        })
        if (state === 'managed-copy-drifted' && !input.force) {
          throw new Error(`skill-copy-mode-drifted: ${linkPath}`)
        }
        await filesystem.remove(linkPath)
        removed.push(linkPath)
      }
    }
    await filesystem.rename(vaultPath, originPath)
  } catch (error) {
    for (const linkPath of removed.toReversed()) {
      await createVaultLink(vaultPath, linkPath, filesystem).catch(() => undefined)
    }
    throw error
  }

  for (const linkPath of removed) {
    if (linkPath === originPath) {
      continue
    }
    await filesystem.copyTree(originPath, linkPath).catch(() => undefined)
  }

  await rebuildSkillVaultIndex(
    input.indexPath,
    (index?.entries ?? []).filter((candidate) => candidate.id !== input.id)
  )
  return { originPath }
}
