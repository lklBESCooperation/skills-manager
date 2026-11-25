import { lstat, readlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  isSkillEffectiveForAgent,
  resolveEffectiveSkills,
  type AgentId,
  type EffectiveSkillState,
  type SkillAgentOverrides,
  type SkillProjectOverrides
} from '../contracts/skill-enablement'
import {
  nativeSkillPathSemantics,
  normalizedSkillPath,
  skillPathsEqual
} from '../contracts/skill-path-containment'
import { classifyCopyModePlacement, type SkillVaultIndex } from '../contracts/skill-vault-contract'
import { isReadonlySkillTarget } from '../infra/readonly-root-fence'
import type { SkillProviderDestination } from '../infra/skill-provider-destinations'
import { computeSkillVaultDigest } from '../vault/skill-vault-index-service'

export type SkillEnablementObservation = {
  skillId: string
  provider: string
  rootPath: string
  /** Real destination of the existing link; null when the entry is not a link to the vault copy. */
  linkTarget: string | null
  /** Any entry exists at the destination (link, directory, or file). */
  exists: boolean
  readsCanonicalRoot: boolean
  isSymbolicLink: boolean
}

export type SkillEnablementMasterLocation =
  | { location: 'vault' }
  | { location: 'canonical' }
  | { location: 'missing' }

export type SkillEnablementPlanAction =
  | { kind: 'add'; observation: SkillEnablementObservation; copyMode?: boolean }
  | { kind: 'remove'; observation: SkillEnablementObservation; copyMode?: boolean }
  | { kind: 'keep'; observation: SkillEnablementObservation }
  | { kind: 'refresh-copy'; observation: SkillEnablementObservation }
  /** One-time migration of a legacy canonical-resident skill into permanent Vault master. */
  | { kind: 'adopt-canonical-to-vault'; observation: SkillEnablementObservation }

export type SkillEnablementPlan = {
  actions: SkillEnablementPlanAction[]
  counts: {
    add: number
    remove: number
    keep: number
    refreshCopy: number
    adoptCanonicalToVault: number
    removeCanonical: number
  }
  /** Unresolvable destinations the applier must not touch (foreign directories or drifted copies). */
  conflicts: SkillEnablementObservation[]
  /** Readonly plugin destinations skipped/blocked by the fence. */
  readonlyBlocked: SkillEnablementObservation[]
  /** Where each planned skill's master lives right now (vault, canonical, or missing). */
  masters: Record<string, SkillEnablementMasterLocation>
}

export type SkillEnablementPlannerInput = {
  vaultRoot: string
  installedSkillIds: readonly string[]
  userDefaults: Readonly<Record<string, EffectiveSkillState | undefined>>
  projectOverrides: Readonly<SkillProjectOverrides>
  userAgentOverrides?: Readonly<SkillAgentOverrides>
  projectAgentOverrides?: Readonly<SkillAgentOverrides>
  scope?: 'global' | 'workspace'
  destinations: readonly SkillProviderDestination[]
  /** Canonical root for this scope; masters found here migrate once into Vault. */
  canonicalRoot?: string
  /** Deprecated compatibility flag: Vault is always permanent master; legacy canonical dirs migrate into Vault. */
  canonicalMoveAllowed?: boolean
  copyMode?: boolean
  vaultIndex?: SkillVaultIndex | null
  readonlyRoots?: readonly string[]
}

async function observePlacement(
  skillId: string,
  destination: SkillProviderDestination
): Promise<SkillEnablementObservation> {
  const destinationPath = join(destination.rootPath, skillId)
  const entryStat = await lstat(destinationPath).catch(() => null)
  if (!entryStat) {
    return {
      skillId,
      provider: destination.provider,
      rootPath: destination.rootPath,
      linkTarget: null,
      exists: false,
      readsCanonicalRoot: destination.readsCanonicalRoot,
      isSymbolicLink: false
    }
  }
  let linkTarget: string | null = null
  const isSym = entryStat.isSymbolicLink()
  if (isSym) {
    const raw = await readlink(destinationPath).catch(() => null)
    if (raw !== null) {
      linkTarget = resolve(destination.rootPath, raw)
    }
  }
  return {
    skillId,
    provider: destination.provider,
    rootPath: destination.rootPath,
    linkTarget,
    exists: true,
    readsCanonicalRoot: destination.readsCanonicalRoot,
    isSymbolicLink: isSym
  }
}

function isVaultMasterLink(observation: SkillEnablementObservation, vaultMasterPath: string): boolean {
  if (!observation.linkTarget) {
    return false
  }
  return skillPathsEqual(observation.linkTarget, vaultMasterPath, nativeSkillPathSemantics())
}

/**
 * Vault is the permanent single master (`<vaultRoot>/<skillId>`). Both canonical `.agents/skills`
 * and private provider roots receive symlinks/junctions (or tracked `copyMode` copies) pointing at
 * Vault. Legacy canonical-resident masters emit a one-time `adopt-canonical-to-vault` action.
 */
export async function planSkillEnablement(
  input: SkillEnablementPlannerInput
): Promise<SkillEnablementPlan> {
  const semantics = nativeSkillPathSemantics()
  const resolution = resolveEffectiveSkills({
    installed: input.installedSkillIds,
    userDefaults: input.userDefaults,
    projectOverrides: input.projectOverrides,
    userAgentOverrides: input.userAgentOverrides,
    projectAgentOverrides: input.projectAgentOverrides,
    scope: input.scope ?? 'global'
  })
  const actions: SkillEnablementPlanAction[] = []
  const conflicts: SkillEnablementObservation[] = []
  const readonlyBlocked: SkillEnablementObservation[] = []
  const masters = await locateSkillMasters(
    input.installedSkillIds,
    input.vaultRoot,
    input.canonicalRoot
  )
  const indexById = new Map((input.vaultIndex?.entries ?? []).map((entry) => [entry.id, entry]))
  const migratedInPlan = new Set<string>()

  for (const destination of input.destinations) {
    for (const skillId of input.installedSkillIds) {
      const target = resolution.get(skillId)
      if (!target) {
        continue
      }
      const observation = await observePlacement(skillId, destination)
      const destinationPath = join(destination.rootPath, skillId)
      if (
        await isReadonlySkillTarget(destinationPath, {
          readonlyRoots: input.readonlyRoots,
          semantics
        })
      ) {
        readonlyBlocked.push(observation)
        continue
      }

      const master = masters[skillId]
      const vaultMasterPath = join(input.vaultRoot, skillId)
      const effectiveForProvider = isSkillEffectiveForAgent(
        target,
        destination.provider as AgentId
      )

      // One-time migration when a skill master still sits in canonical without a Vault copy.
      if (
        destination.readsCanonicalRoot &&
        master?.location === 'canonical' &&
        !migratedInPlan.has(skillId) &&
        observation.exists
      ) {
        migratedInPlan.add(skillId)
        actions.push({ kind: 'adopt-canonical-to-vault', observation })
        if (effectiveForProvider) {
          actions.push({ kind: 'add', observation, copyMode: input.copyMode })
        }
        continue
      }

      const linkedToVault = isVaultMasterLink(observation, vaultMasterPath)

      // Handle copyMode placements via 3-way digest protection (Q6).
      if (observation.exists && !observation.isSymbolicLink && input.copyMode) {
        const entry = indexById.get(skillId)
        const placement = entry?.managedPlacements?.[normalizedSkillPath(destinationPath, semantics)]
        if (entry && placement?.topology === 'copy') {
          const observedDigest = await computeSkillVaultDigest(destinationPath).catch(() => null)
          const copyState = classifyCopyModePlacement({
            vaultDigest: entry.digest,
            observedDigest,
            placement
          })
          if (copyState === 'managed-copy-drifted') {
            // Drifted local edits are protected; never auto-delete or overwrite!
            conflicts.push(observation)
            continue
          }
          if (effectiveForProvider) {
            actions.push(
              copyState === 'managed-copy-outdated'
                ? { kind: 'refresh-copy', observation }
                : { kind: 'keep', observation }
            )
          } else {
            actions.push({ kind: 'remove', observation, copyMode: true })
          }
          continue
        }
      }

      if (observation.exists && !linkedToVault) {
        conflicts.push(observation)
        continue
      }

      if (effectiveForProvider) {
        actions.push(
          linkedToVault
            ? { kind: 'keep', observation }
            : { kind: 'add', observation, copyMode: input.copyMode }
        )
      } else {
        actions.push(
          linkedToVault
            ? { kind: 'remove', observation, copyMode: input.copyMode }
            : { kind: 'keep', observation }
        )
      }
    }
  }

  const counts = {
    add: actions.filter((action) => action.kind === 'add').length,
    remove: actions.filter((action) => action.kind === 'remove').length,
    keep: actions.filter((action) => action.kind === 'keep').length,
    refreshCopy: actions.filter((action) => action.kind === 'refresh-copy').length,
    adoptCanonicalToVault: actions.filter((action) => action.kind === 'adopt-canonical-to-vault')
      .length,
    removeCanonical: actions.filter(
      (action) => action.kind === 'remove' && action.observation.readsCanonicalRoot
    ).length
  }
  return { actions, counts, conflicts, readonlyBlocked, masters }
}

async function locateSkillMasters(
  skillIds: readonly string[],
  vaultRoot: string,
  canonicalRoot: string | undefined
): Promise<Record<string, SkillEnablementMasterLocation>> {
  const masters: Record<string, SkillEnablementMasterLocation> = {}
  for (const skillId of skillIds) {
    const inVault = await lstat(join(vaultRoot, skillId)).catch(() => null)
    if (inVault) {
      masters[skillId] = { location: 'vault' }
      continue
    }
    const canonical = canonicalRoot
      ? await lstat(join(canonicalRoot, skillId)).catch(() => null)
      : null
    masters[skillId] = canonical ? { location: 'canonical' } : { location: 'missing' }
  }
  return masters
}

export { resolveEffectiveSkills }
