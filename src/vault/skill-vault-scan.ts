import { readlink, realpath, stat } from 'node:fs/promises'
import { basename, sep } from 'node:path'
import type { SkillVaultIndex } from '../contracts/skill-vault-contract'
import { readSkillInstallReceipt } from '../infra/skill-state-store'
import { computeSkillVaultDigest, skillVaultSizeBytes } from './skill-vault-index-service'
import { normalizedSkillVaultPath } from './skill-vault-paths'

// ② vault attribution scan (PRD §8 1.4): pure planning over the filesystem;
// adopt performs every mutation. Install receipts decide Orca-managed skips.

export type SkillVaultDisposition =
  | 'managed'
  | 'adoptable'
  | 'duplicate-same-digest'
  | 'conflict'
  | 'orca-managed'

export type SkillVaultCandidate = {
  id: string
  path: string
  digest: string
  mtimeMs: number | null
  sizeBytes: number
}

export type SkillVaultAdoptItem = {
  id: string
  disposition: SkillVaultDisposition
  digest: string
  /** The copy that becomes the vault primary. */
  originPath: string
  /** Copies at the same digest that adopt turns into links to the primary. */
  mergePaths: string[]
}

export type SkillVaultScanItem = {
  id: string
  disposition: SkillVaultDisposition
  originPath: string
  digest: string
  sizeBytes: number
  mtimeMs: number | null
  mergePaths: string[]
  /** Conflicting variants with differing digests; listed for a user decision. */
  conflicts: SkillVaultCandidate[]
}

export type SkillVaultScanPlan = {
  items: SkillVaultScanItem[]
  counts: {
    managed: number
    adoptable: number
    merged: number
    conflicts: number
    orcaManaged: number
  }
}

export type SkillVaultScanInput = {
  homeDirectory: string
  vaultRoot: string
  /** Skill directories found by discovery in agent roots (vault root excluded). */
  candidatePaths: readonly string[]
  /** Install receipts directory; omitting it disables Orca-managed detection. */
  installStateDirectory?: string
  /** Reserved for index-driven fast paths; the scan stays filesystem-driven. */
  index?: SkillVaultIndex | null
}

type ObservedCandidate = {
  id: string
  path: string
  digest: string | null
  mtimeMs: number | null
  isLinkToVault: boolean
  orcaManaged: boolean
}

function isInsideVault(path: string, vaultRoot: string): boolean {
  const normalizedRoot = normalizedSkillVaultPath(vaultRoot)
  const normalizedPath = normalizedSkillVaultPath(path)
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}${process.platform === 'win32' ? '\\' : sep}`)
  )
}

async function linkResolvesInsideVault(candidatePath: string, vaultRoot: string): Promise<boolean> {
  // A managed placement is a link whose target resolves inside the vault root.
  const isLink = await readlink(candidatePath)
    .then(() => true)
    .catch(() => false)
  if (!isLink) {
    return false
  }
  const resolved = await realpath(candidatePath).catch(() => null)
  // macOS temp dirs are themselves symlinks (/tmp -> /private/tmp), so resolve
  // both sides before comparing; a not-yet-created vault root falls back lexical.
  const resolvedRoot = await realpath(vaultRoot).catch(() => vaultRoot)
  return resolved !== null && isInsideVault(resolved, resolvedRoot)
}

/** Group candidates by directory name; each group's verdict is one plan row. */
export async function scanSkillVault(input: SkillVaultScanInput): Promise<SkillVaultScanPlan> {
  const observed: ObservedCandidate[] = []
  for (const candidatePath of input.candidatePaths) {
    const stats = await stat(candidatePath).catch(() => null)
    const isLinkToVault = await linkResolvesInsideVault(candidatePath, input.vaultRoot)
    const receipt = input.installStateDirectory
      ? await readSkillInstallReceipt(input.installStateDirectory, candidatePath).catch(() => null)
      : null
    // Digests are unnecessary for links (content lives in the vault) and receipts.
    const digest =
      isLinkToVault || receipt
        ? null
        : await computeSkillVaultDigest(candidatePath).catch(() => null)
    observed.push({
      id: basename(candidatePath),
      path: candidatePath,
      digest,
      mtimeMs: stats?.mtimeMs ?? null,
      isLinkToVault,
      orcaManaged: receipt !== null
    })
  }

  const byId = new Map<string, ObservedCandidate[]>()
  for (const candidate of observed) {
    const group = byId.get(candidate.id) ?? []
    group.push(candidate)
    byId.set(candidate.id, group)
  }

  const items: SkillVaultScanItem[] = []
  for (const [id, group] of [...byId.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const managed = group.find((candidate) => candidate.isLinkToVault)
    if (managed) {
      items.push(managedItem(id, managed))
      continue
    }
    const orcaManaged = group.find((candidate) => candidate.orcaManaged)
    if (orcaManaged) {
      items.push(orcaManagedItem(id, orcaManaged))
      continue
    }

    // flatMap maps the null check onto the element type so digest stays `string` downstream.
    const digested = group.flatMap((candidate) =>
      candidate.digest === null ? [] : [{ ...candidate, digest: candidate.digest }]
    )
    if (digested.length === 0) {
      continue
    }
    const sorted = [...digested].sort((left, right) => left.path.localeCompare(right.path))
    const distinctDigests = new Set(sorted.map((candidate) => candidate.digest))
    if (distinctDigests.size > 1) {
      // The user edited copies apart; adopt never picks a winner silently (PRD §2.3).
      items.push({
        id,
        disposition: 'conflict',
        originPath: sorted[0].path,
        digest: '',
        sizeBytes: 0,
        mtimeMs: sorted[0].mtimeMs,
        mergePaths: [],
        conflicts: sorted.map((candidate) => ({
          id: candidate.id,
          path: candidate.path,
          digest: candidate.digest,
          mtimeMs: candidate.mtimeMs,
          sizeBytes: 0
        }))
      })
      continue
    }

    const primary = sorted[0]
    const merges = sorted.slice(1)
    items.push({
      id,
      disposition: 'adoptable',
      originPath: primary.path,
      digest: primary.digest,
      sizeBytes: await skillVaultSizeBytes(primary.path).catch(() => 0),
      mtimeMs: primary.mtimeMs,
      mergePaths: merges.map((candidate) => candidate.path),
      conflicts: []
    })
  }

  return {
    items,
    counts: {
      managed: items.filter((item) => item.disposition === 'managed').length,
      adoptable: items.filter((item) => item.disposition === 'adoptable').length,
      merged: items.reduce((total, item) => total + item.mergePaths.length, 0),
      conflicts: items.filter((item) => item.disposition === 'conflict').length,
      orcaManaged: items.filter((item) => item.disposition === 'orca-managed').length
    }
  }
}

function managedItem(id: string, candidate: ObservedCandidate): SkillVaultScanItem {
  return {
    id,
    disposition: 'managed',
    originPath: candidate.path,
    digest: '',
    sizeBytes: 0,
    mtimeMs: candidate.mtimeMs,
    mergePaths: [],
    conflicts: []
  }
}

function orcaManagedItem(id: string, candidate: ObservedCandidate): SkillVaultScanItem {
  return {
    id,
    disposition: 'orca-managed',
    originPath: candidate.path,
    digest: '',
    sizeBytes: 0,
    mtimeMs: candidate.mtimeMs,
    mergePaths: [],
    conflicts: []
  }
}

/** Rows an adopt run acts on; conflicts stay out for an explicit user choice. */
export function adoptableSkillVaultItems(plan: SkillVaultScanPlan): SkillVaultAdoptItem[] {
  return plan.items
    .filter((item) => item.disposition === 'adoptable')
    .map((item) => ({
      id: item.id,
      disposition: item.disposition,
      digest: item.digest,
      originPath: item.originPath,
      mergePaths: [...item.mergePaths]
    }))
}
