import { type DynamicPackRule, type DynamicPackRuleV2 } from '../contracts/skill-pack-contract';
export type SkillVaultEntryLike = {
    id: string;
    name: string;
    description?: string | null;
    sourceKind: 'adopted' | 'installed' | 'bundled' | 'conflict';
    tags: string[];
    author: string | null;
    /** Readonly plugin/bundled entries are hard-excluded from dynamic pack evaluation. */
    readonly?: boolean;
    scope?: 'user' | 'project';
    agents?: readonly string[];
    originRoot?: string | null;
    enabled?: boolean;
};
/**
 * ⑤ read-time evaluation of a dynamic pack rule (v1 or v2) against vault index entries.
 * Pure: conflict and readonly plugin entries never match.
 */
export declare function evaluateDynamicPack<T extends SkillVaultEntryLike>(rule: DynamicPackRule | DynamicPackRuleV2, entries: readonly T[]): T[];
export declare function dynamicPackMemberIds(rule: DynamicPackRule | DynamicPackRuleV2, entries: readonly SkillVaultEntryLike[]): string[];
