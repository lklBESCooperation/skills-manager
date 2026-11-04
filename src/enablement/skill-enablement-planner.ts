import { lstat, readlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  resolveEffectiveSkills,
  type EffectiveSkillState,
  type SkillProjectOverrides
} from '../contracts/skill-enablement'
import { nativeSkillPathSemantics, skillPathsEqual } from '../contracts/skill-path-containment'
import type { SkillProviderDestination } from '../infra/skill-provider-destinations'

export type SkillEnablementObservation = {
  skillId: string
  provider: string
  rootPath: string
  /** Real destination of the existing link; null when the entry is not a link to the vault copy. */
  linkTarget: string | null
  /** Any entry exists at the destination (link, directory, or file). */
  exists: boolean
  readsCanonicalRoot: boolean
}

export type SkillEnablementMasterLocation =
  | { location: 'vault' }
  | { location: 'canonical' }
  | { location: 'missing' }

export type SkillEnablementPlanAction =
  | { kind: 'add'; observation: SkillEnablementObservation }
  | { kind: 'remove'; observation: SkillEnablementObservation }
  | { kind: 'keep'; observation: SkillEnablementObservation }
  /** Canonical-root providers enable by moving the vault master into canonical, not by linking. */
  | { kind: 'move-to-canonical'; observation: SkillEnablementObservation }

export type SkillEnablementPlan = {
  actions: SkillEnablementPlanAction[]
  counts: {
    add: number
    remove: number
    keep: number
    moveToCanonical: number
    removeCanonical: number
  }
  /** Unresolvable destinations the applier must not touch (foreign directories at a target). */
  conflicts: SkillEnablementObservation[]
  /** Where each planned skill's master lives right now (vault, canonical, or missing). */
  masters: Record<string, SkillEnablementMasterLocation>
}

export type SkillEnablementPlannerInput = {
  vaultRoot: string
  installedSkillIds: readonly string[]
  userDefaults: Readonly<Record<string, EffectiveSkillState | undefined>>
  projectOverrides: Readonly<SkillProjectOverrides>
  destinations: readonly SkillProviderDestination[]
  /** Canonical root for this scope; masters found here count as installed. */
  canonicalRoot?: string
  /**
   * Moves relocate the single master, so they may only cross vault↔canonical inside one
   * scope. A canonical root outside the vault's scope gets a plain link instead.
   */
  canonicalMoveAllowed?: boolean
}

/** lstat semantics: a link that points anywhere still reports as a link; resolve for target compare. */
async function observePlacement(
  skillId: string,
  destination: SkillProviderDestination
): Promise<SkillEnablementObservation> {
  const destinationPath = join(destination.rootPath, skillId)
  const stat = await lstat(destinationPath).catch(() => null)
  if (!stat) {
    return {
      skillId,
      provider: destination.provider,
      rootPath: destination.rootPath,
      linkTarget: null,
      exists: false,
      readsCanonicalRoot: destination.readsCanonicalRoot
    }
  }
  let linkTarget: string | null = null
  if (stat.isSymbolicLink()) {
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
    readsCanonicalRoot: destination.readsCanonicalRoot
  }
}

function isMasterLink(observation: SkillEnablementObservation, masterPath: string): boolean {
  if (!observation.linkTarget) {
    return false
  }
  return skillPathsEqual(observation.linkTarget, masterPath, nativeSkillPathSemantics())
}

/**
 * Diff actual per-provider placement against the resolved target. Non-canonical roots plan a
 * link (add), unlink (remove), or keep; canonical-root providers plan a master move instead.
 */
export async function planSkillEnablement(
  input: SkillEnablementPlannerInput
): Promise<SkillEnablementPlan> {
  const resolution = resolveEffectiveSkills({
    installed: input.installedSkillIds,
    userDefaults: input.userDefaults,
    projectOverrides: input.projectOverrides
  })
  const actions: SkillEnablementPlanAction[] = []
  const conflicts: SkillEnablementObservation[] = []
  const masters = await locateSkillMasters(
    input.installedSkillIds,
    input.vaultRoot,
    input.canonicalRoot
  )
  for (const destination of input.destinations) {
    for (const skillId of input.installedSkillIds) {
      const target = resolution.get(skillId)
      if (!target) {
        continue
      }
      const observation = await observePlacement(skillId, destination)
      if (destination.readsCanonicalRoot && input.canonicalMoveAllowed) {
        // Canonical holds masters for this provider; enable=master present, disable=absent.
        const canonicalEnabled = observation.exists
        if (target.effective === 'enabled') {
          actions.push(
            canonicalEnabled
              ? { kind: 'keep', observation }
              : { kind: 'move-to-canonical', observation }
          )
        } else if (canonicalEnabled) {
          actions.push({ kind: 'remove', observation })
        } else {
          actions.push({ kind: 'keep', observation })
        }
        continue
      }
      // Compare against the master's real current location so a valid link is never
      // misread as foreign after a canonical provider moved it out of the vault.
      const linked = isMasterLink(observation, masterLinkTarget(input, skillId, masters))
      if (observation.exists && !linked) {
        // A foreign directory/file owns the name; never delete or overwrite it.
        conflicts.push(observation)
        continue
      }
      if (target.effective === 'enabled') {
        actions.push(linked ? { kind: 'keep', observation } : { kind: 'add', observation })
      } else {
        actions.push(linked ? { kind: 'remove', observation } : { kind: 'keep', observation })
      }
    }
  }
  const counts = {
    add: actions.filter((action) => action.kind === 'add').length,
    remove: actions.filter((action) => action.kind === 'remove').length,
    keep: actions.filter((action) => action.kind === 'keep').length,
    moveToCanonical: actions.filter((action) => action.kind === 'move-to-canonical').length,
    removeCanonical: actions.filter(
      (action) => action.kind === 'remove' && action.observation.readsCanonicalRoot
    ).length
  }
  return { actions, counts, conflicts, masters }
}

/** The link for a non-canonical provider must follow the master wherever it currently lives. */
function masterLinkTarget(
  input: Pick<SkillEnablementPlannerInput, 'vaultRoot' | 'canonicalRoot'>,
  skillId: string,
  masters: Record<string, SkillEnablementMasterLocation>
): string {
  const master = masters[skillId]
  if (master?.location === 'canonical' && input.canonicalRoot) {
    return join(input.canonicalRoot, skillId)
  }
  return join(input.vaultRoot, skillId)
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
