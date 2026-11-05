import type { DynamicPackRule } from '../contracts/skill-pack-contract';
export type SkillVaultEntryLike = {
    id: string;
    name: string;
    sourceKind: 'adopted' | 'installed' | 'bundled' | 'conflict';
    tags: string[];
    author: string | null;
};
/**
 * ⑤ read-time evaluation of a dynamic pack rule against vault index entries.
 * Pure: same rule + same index → same member set; index updates change the
 * result with no re-save (PRD §5.2). Conflict entries never match. Empty hit
 * sets are valid ("author has no new skills yet").
 */
export declare function evaluateDynamicPack<T extends SkillVaultEntryLike>(rule: DynamicPackRule, entries: readonly T[]): T[];
export declare function dynamicPackMemberIds(rule: DynamicPackRule, entries: readonly SkillVaultEntryLike[]): string[];
