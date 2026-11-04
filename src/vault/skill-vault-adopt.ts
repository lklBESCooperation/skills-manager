import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import type { SkillVaultIndex } from '../contracts/skill-vault-contract'
import { SKILL_VAULT_STAGE_MARKER } from './staging-marker'
import { renameSkillPathWithWindowsRetry } from '../infra/skill-filesystem-retry'
import { summarizeSkillMarkdown } from '../contracts/skill-metadata'
import {
  computeSkillVaultDigest,
  detectSkillVaultCopyMode,
  rebuildSkillVaultIndex,
  readSkillVaultIndex,
  skillVaultSizeBytes
} from './skill-vault-index-service'
import { skillVaultEntryRoot } from './skill-vault-paths'

// ② adopt transaction (PRD §8 1.5): stage everything first, then move primaries
// into the vault, replace origins with symlinks, and write the index last. Any
// failure rolls the whole batch back to the pre-run tree.

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

type AdoptedRecord = {
  id: string
  vaultPath: string
  originPath: string
  mergePaths: string[]
  digest: string
  name: string
  description: string | null
  sizeBytes: number
  installedAt: string
}

export async function adoptSkillsIntoVault(input: {
  homeDirectory: string
  vaultRoot: string
  indexPath: string
  items: readonly SkillVaultAdoptItemInput[]
  filesystem?: SkillVaultAdoptFilesystem
}): Promise<SkillVaultAdoptOutcome> {
  const filesystem = input.filesystem ?? nativeSkillVaultAdoptFilesystem
  const copyMode = await detectSkillVaultCopyMode(input.vaultRoot)
  await filesystem.mkdir(input.vaultRoot)

  // Every origin (primary + merges) stages first; rollback restores by stage
  // or by vault path depending on how far the batch progressed.
  const staged = new Map<string, string>()
  const movedToVault = new Map<string, string>() // originPath -> vaultPath
  const linked: string[] = []

  const rollback = async (): Promise<void> => {
    // Reverse order: drop replacement links, move vault copies back, drop stages.
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
    // Phase 1: stage every origin and duplicate so the tree is frozen batch-wide.
    for (const item of input.items) {
      for (const originPath of [item.originPath, ...item.mergePaths]) {
        const stagePath = stagePathFor(originPath)
        await filesystem.rename(originPath, stagePath)
        staged.set(originPath, stagePath)
      }
    }

    // Phase 2: move the primary stages into the vault.
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

    // Phase 3: replace every origin with a link (or copy) at the vault primary.
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

    // Phase 4: write the index last; the filesystem is already the source of truth.
    const previous = await readSkillVaultIndex(input.indexPath)
    const now = new Date().toISOString()
    const records: AdoptedRecord[] = []
    for (const item of input.items) {
      const vaultPath = skillVaultEntryRoot(input.vaultRoot, item.id)
      const markdown = await filesystem.readFile(join(vaultPath, 'SKILL.md')).catch(() => '')
      const summary = summarizeSkillMarkdown(markdown)
      records.push({
        id: item.id,
        vaultPath,
        originPath: item.originPath,
        mergePaths: [...item.mergePaths],
        digest: await computeSkillVaultDigest(vaultPath),
        name: summary.name ?? item.id,
        description: summary.description,
        sizeBytes: await skillVaultSizeBytes(vaultPath).catch(() => 0),
        installedAt: previous?.entries.find((entry) => entry.id === item.id)?.installedAt ?? now
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

function toIndexEntry(
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
    ...(copyMode ? { copyMode: true } : {})
  }
}

/** Cancel management for one entry: move the primary back and drop its links. */
export async function unadoptSkillFromVault(input: {
  vaultRoot: string
  indexPath: string
  id: string
  /** Additional link locations to clear beyond the recorded origin. */
  extraLinkPaths?: readonly string[]
  filesystem?: SkillVaultAdoptFilesystem
}): Promise<{ originPath: string }> {
  const filesystem = input.filesystem ?? nativeSkillVaultAdoptFilesystem
  const index = await readSkillVaultIndex(input.indexPath)
  const entry = index?.entries.find((candidate) => candidate.id === input.id)
  if (!entry) {
    throw new Error(`skill-vault-unknown-entry: ${input.id}`)
  }
  const vaultPath = skillVaultEntryRoot(input.vaultRoot, input.id)
  const originPath = entry.originPath ?? join(dirname(vaultPath), 'restored', input.id)

  // Recorded linkPaths cover every replaced origin (primary + merged copies).
  const linkPaths = [
    ...new Set([originPath, ...(entry.linkPaths ?? []), ...(input.extraLinkPaths ?? [])])
  ]
  const removed: string[] = []
  try {
    await filesystem.mkdir(dirname(originPath))
    for (const linkPath of linkPaths) {
      if ((await filesystem.lstat(linkPath))?.isSymbolicLink()) {
        await filesystem.remove(linkPath)
        removed.push(linkPath)
      }
    }
    await filesystem.rename(vaultPath, originPath)
  } catch (error) {
    // Restore links already dropped before the primary move failed.
    for (const linkPath of removed.toReversed()) {
      await createVaultLink(vaultPath, linkPath, filesystem).catch(() => undefined)
    }
    throw error
  }

  // Merged duplicates were byte-identical; restore them as copies of the
  // returned primary so every pre-adoption location holds the skill again.
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
