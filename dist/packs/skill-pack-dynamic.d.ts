import { type DynamicSkillPack, type SkillPack, type SkillPackOperationMode, type SkillPackPreviewDiff } from '../contracts/skill-pack-contract';
import { type SkillVaultEntryLike } from './skill-pack-rule-eval';
export type SkillPackDiffFn = (currentEnabledIds: readonly string[], memberIds: readonly string[], mode: SkillPackOperationMode) => SkillPackPreviewDiff;
export type DynamicPackHitEntry = {
    id: string;
    name: string;
};
export type DynamicPackPreview = {
    /** Evaluated member set — what the user actually confirms (PRD §5.2). */
    hitIds: string[];
    hitEntries: DynamicPackHitEntry[];
    diff: SkillPackPreviewDiff;
};
export type DynamicPackApplyResult = {
    /** Members handed to the static apply path — always identical to hitIds. */
    appliedMemberIds: string[];
} & DynamicPackPreview;
/**
 * ⑤ dynamic pack preview: evaluate the rule at read time, feed the hit set into
 * the same preview used by static packs, and return the hit list alongside so
 * the UI can show "命中 N 个: …" before confirmation.
 */
export declare function previewDynamicSkillPack(input: {
    pack: DynamicSkillPack;
    entries: readonly SkillVaultEntryLike[];
    currentEnabledIds: readonly string[];
    mode: SkillPackOperationMode;
    computeDiff: SkillPackDiffFn;
}): DynamicPackPreview;
/**
 * ⑤ dynamic pack apply: evaluate, then ride the exact same static apply path
 * (`applyMembers`) with the evaluated member list. Returned `appliedMemberIds`
 * equals `hitIds` of the preview over the same index — assert this where the
 * service wires both steps (T4.6).
 */
export declare function applyDynamicSkillPack<T>(input: {
    pack: DynamicSkillPack;
    entries: readonly SkillVaultEntryLike[];
    currentEnabledIds: readonly string[];
    mode: SkillPackOperationMode;
    computeDiff: SkillPackDiffFn;
    applyMembers: (memberIds: readonly string[]) => T;
}): DynamicPackApplyResult & {
    applied: T;
};
/** Dispatch used by the service for mixed pack lists: dynamic → evaluate first. */
export declare function previewSkillPack(input: {
    pack: SkillPack;
    entries: readonly SkillVaultEntryLike[];
    currentEnabledIds: readonly string[];
    mode: SkillPackOperationMode;
    computeDiff: SkillPackDiffFn;
}): SkillPackPreviewDiff & {
    hitIds?: string[];
    hitEntries?: DynamicPackHitEntry[];
};
