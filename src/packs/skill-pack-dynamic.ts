import {
  isDynamicSkillPack,
  type DynamicSkillPack,
  type SkillPack,
  type SkillPackOperationMode,
  type SkillPackPreviewDiff
} from '../contracts/skill-pack-contract'
import { evaluateDynamicPack, type SkillVaultEntryLike } from './skill-pack-rule-eval'

// Injected P3 3.3 preview function (src/main/skills/packs/skill-pack-preview.ts):
// (current set, member set, mode) → diff. Kept injectable until that module lands;
// see the TODO at the bottom for the one-line merge.
export type SkillPackDiffFn = (
  currentEnabledIds: readonly string[],
  memberIds: readonly string[],
  mode: SkillPackOperationMode
) => SkillPackPreviewDiff

export type DynamicPackHitEntry = {
  id: string
  name: string
}

export type DynamicPackPreview = {
  /** Evaluated member set — what the user actually confirms (PRD §5.2). */
  hitIds: string[]
  hitEntries: DynamicPackHitEntry[]
  diff: SkillPackPreviewDiff
}

export type DynamicPackApplyResult = {
  /** Members handed to the static apply path — always identical to hitIds. */
  appliedMemberIds: string[]
} & DynamicPackPreview

/**
 * ⑤ dynamic pack preview: evaluate the rule at read time, feed the hit set into
 * the same preview used by static packs, and return the hit list alongside so
 * the UI can show "命中 N 个: …" before confirmation.
 */
export function previewDynamicSkillPack(input: {
  pack: DynamicSkillPack
  entries: readonly SkillVaultEntryLike[]
  currentEnabledIds: readonly string[]
  mode: SkillPackOperationMode
  computeDiff: SkillPackDiffFn
}): DynamicPackPreview {
  const hits = evaluateDynamicPack(input.pack.dynamic, input.entries)
  const hitIds = hits.map((entry) => entry.id)
  return {
    hitIds,
    hitEntries: hits.map((entry) => ({ id: entry.id, name: entry.name })),
    diff: input.computeDiff(input.currentEnabledIds, hitIds, input.mode)
  }
}

/**
 * ⑤ dynamic pack apply: evaluate, then ride the exact same static apply path
 * (`applyMembers`) with the evaluated member list. Returned `appliedMemberIds`
 * equals `hitIds` of the preview over the same index — assert this where the
 * service wires both steps (T4.6).
 */
export function applyDynamicSkillPack<T>(input: {
  pack: DynamicSkillPack
  entries: readonly SkillVaultEntryLike[]
  currentEnabledIds: readonly string[]
  mode: SkillPackOperationMode
  computeDiff: SkillPackDiffFn
  applyMembers: (memberIds: readonly string[]) => T
}): DynamicPackApplyResult & { applied: T } {
  const preview = previewDynamicSkillPack(input)
  const applied = input.applyMembers(preview.hitIds)
  return { ...preview, appliedMemberIds: preview.hitIds, applied }
}

/** Dispatch used by the service for mixed pack lists: dynamic → evaluate first. */
export function previewSkillPack(input: {
  pack: SkillPack
  entries: readonly SkillVaultEntryLike[]
  currentEnabledIds: readonly string[]
  mode: SkillPackOperationMode
  computeDiff: SkillPackDiffFn
}): SkillPackPreviewDiff & { hitIds?: string[]; hitEntries?: DynamicPackHitEntry[] } {
  if (!isDynamicSkillPack(input.pack)) {
    return input.computeDiff(input.currentEnabledIds, input.pack.members, input.mode)
  }
  const preview = previewDynamicSkillPack({ ...input, pack: input.pack })
  return { ...preview.diff, hitIds: preview.hitIds, hitEntries: preview.hitEntries }
}

/*
 * TODO(P3 merge — step 4.3, one line each once skill-pack-service.ts lands):
 * 1. preview entry point:
 *      previewSkillPack({ pack, entries: vaultIndex.entries, currentEnabledIds, mode, computeDiff })
 *    where computeDiff delegates to the real skill-pack-preview export
 *    (adapt the mode argument to its actual signature if it differs).
 * 2. apply/switch confirm path: call applyDynamicSkillPack with the service's
 *    existing static applyMembers (the function that lands enable/disable links)
 *    so dynamic packs change no apply semantics.
 */
