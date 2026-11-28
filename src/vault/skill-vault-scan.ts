import { readlink, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import {
  classifyCopyModePlacement,
  type CopyModePlacementState,
  type SkillVaultIndex
} from '../contracts/skill-vault-contract'
import { nativeSkillPathSemantics, normalizedSkillPath } from '../contracts/skill-path-containment'
import { isReadonlySkillTarget } from '../infra/readonly-root-fence'
import { readSkillInstallReceipt } from '../infra/skill-state-store'
import { computeSkillVaultDigest, skillVaultSizeBytes } from './skill-vault-index-service'
import { normalizedSkillVaultPath } from './skill-vault-paths'
import { isSkillStagingEntryName } from './staging-marker'

// ② vault attribution scan (PRD §8 1.4): pure planning over the filesystem;
// adopt performs every mutation. Install receipts decide Orca-managed skips,
// and readonly plugin roots are strictly excluded.

export type SkillVaultDisposition =
  | 'managed'
  | 'adoptable'
  | 'duplicate-same-digest'
  | 'conflict'
  | 'orca-managed'
  | 'copy-drifted'
  | 'copy-outdated'

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
  copyModeState?: CopyModePlacementState
}

export type SkillVaultScanPlan = {
  items: SkillVaultScanItem[]
  counts: {
    managed: number
    adoptable: number
    merged: number
    conflicts: number
    orcaManaged: number
    copyDrifted: number
    copyOutdated: number
    skippedReadonly: number
  }
}

export type SkillVaultScanInput = {
  homeDirectory: string
  vaultRoot: string
  /** Skill directories found by discovery in agent roots (vault root excluded). */
  candidatePaths: readonly string[]
  /** Install receipts directory; omitting it disables Orca-managed detection. */
  installStateDirectory?: string
  /** Index used for copyMode 3-way digest drift detection. */
  index?: SkillVaultIndex | null
  /** Dynamic readonly plugin roots to exclude alongside static plugin prefixes. */
  readonlyRoots?: readonly string[]
}

type ObservedCandidate = {
  id: string
  path: string
  digest: string | null
  mtimeMs: number | null
  isLinkToVault: boolean
  orcaManaged: boolean
  copyState?: CopyModePlacementState
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
  const rawTarget = await readlink(candidatePath).catch(() => null)
  if (rawTarget === null) {
    return false
  }
  const targetExists = await stat(candidatePath)
    .then(() => true)
    .catch(() => false)
  if (!targetExists) {
    return false
  }
  const resolvedRoot = await realpath(vaultRoot).catch(() => resolve(vaultRoot))
  const resolved = await realpath(candidatePath).catch(() => null)
  if (resolved !== null && isInsideVault(resolved, resolvedRoot)) {
    return true
  }
  // Also check immediate link target so a vault entry that itself symlinks to an external repo counts as managed.
  const realParent = await realpath(dirname(candidatePath)).catch(() => resolve(dirname(candidatePath)))
  const immediateTarget = resolve(realParent, rawTarget)
  return isInsideVault(immediateTarget, resolvedRoot)
}

/** Group candidates by directory name; each group's verdict is one plan row. */
export async function scanSkillVault(input: SkillVaultScanInput): Promise<SkillVaultScanPlan> {
  const semantics = nativeSkillPathSemantics()
  const indexById = new Map((input.index?.entries ?? []).map((entry) => [entry.id, entry]))
  const observed: ObservedCandidate[] = []
  let skippedReadonly = 0

  for (const candidatePath of input.candidatePaths) {
    const id = basename(candidatePath)
    if (isSkillStagingEntryName(id)) {
      continue
    }
    if (await isReadonlySkillTarget(candidatePath, { readonlyRoots: input.readonlyRoots, semantics })) {
      skippedReadonly += 1
      continue
    }
    const [dirStats, skillMdStats] = await Promise.all([
      stat(candidatePath).catch(() => null),
      stat(join(candidatePath, 'SKILL.md')).catch(() => null)
    ])
    const mtimeMs = skillMdStats?.mtimeMs ?? dirStats?.mtimeMs ?? null
    const isLinkToVault = await linkResolvesInsideVault(candidatePath, input.vaultRoot)
    const receipt = input.installStateDirectory
      ? await readSkillInstallReceipt(input.installStateDirectory, candidatePath).catch(() => null)
      : null

    const indexedEntry = indexById.get(id)
    const placementKey = normalizedSkillPath(candidatePath, semantics)
    const placement = indexedEntry?.managedPlacements?.[placementKey]

    // Digests are skipped for vault links and receipts unless needed to classify a copyMode placement.
    const needsDigest = (!isLinkToVault && !receipt) || placement?.topology === 'copy'
    const digest = needsDigest
      ? await computeSkillVaultDigest(candidatePath).catch(() => null)
      : null

    let copyState: CopyModePlacementState | undefined
    if (placement?.topology === 'copy' && indexedEntry) {
      copyState = classifyCopyModePlacement({
        vaultDigest: indexedEntry.digest,
        observedDigest: digest,
        placement
      })
    }

    observed.push({
      id,
      path: candidatePath,
      digest,
      mtimeMs,
      isLinkToVault,
      orcaManaged: receipt !== null,
      copyState
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
    const drifted = group.find((candidate) => candidate.copyState === 'managed-copy-drifted')
    if (drifted) {
      items.push({
        id,
        disposition: 'copy-drifted',
        originPath: drifted.path,
        digest: drifted.digest ?? '',
        sizeBytes: 0,
        mtimeMs: drifted.mtimeMs,
        mergePaths: [],
        conflicts: [],
        copyModeState: 'managed-copy-drifted'
      })
      continue
    }
    const outdated = group.find((candidate) => candidate.copyState === 'managed-copy-outdated')
    if (outdated) {
      items.push({
        id,
        disposition: 'copy-outdated',
        originPath: outdated.path,
        digest: outdated.digest ?? '',
        sizeBytes: 0,
        mtimeMs: outdated.mtimeMs,
        mergePaths: [],
        conflicts: [],
        copyModeState: 'managed-copy-outdated'
      })
      continue
    }
    const managedCopy = group.find((candidate) => candidate.copyState === 'managed-copy-clean')
    if (managedCopy) {
      items.push({
        ...managedItem(id, managedCopy),
        copyModeState: 'managed-copy-clean'
      })
      continue
    }

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

    const digested = group.flatMap((candidate) =>
      candidate.digest === null ? [] : [{ ...candidate, digest: candidate.digest }]
    )
    if (digested.length === 0) {
      continue
    }
    const sorted = [...digested].sort((left, right) => left.path.localeCompare(right.path))
    const vaultEntryPath = join(input.vaultRoot, id)
    const vaultEntryExists = await stat(vaultEntryPath)
      .then((s) => s.isDirectory())
      .catch(() => false)
    if (vaultEntryExists) {
      const vaultDigest =
        indexById.get(id)?.digest ?? (await computeSkillVaultDigest(vaultEntryPath).catch(() => null))
      if (vaultDigest !== null) {
        if (sorted.every((candidate) => candidate.digest === vaultDigest)) {
          items.push(managedItem(id, { ...sorted[0], path: vaultEntryPath }))
          continue
        }
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
    }
    const distinctDigests = new Set(sorted.map((candidate) => candidate.digest))
    if (distinctDigests.size > 1) {
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
      orcaManaged: items.filter((item) => item.disposition === 'orca-managed').length,
      copyDrifted: items.filter((item) => item.disposition === 'copy-drifted').length,
      copyOutdated: items.filter((item) => item.disposition === 'copy-outdated').length,
      skippedReadonly
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
