import { type SkillInstallFailure } from '../contracts/skill-install-failure';
export type BatchSkillFailure = {
    skillId: string;
    error: string;
    failure: SkillInstallFailure;
};
export type BatchOperationReport<TSucceeded = string> = {
    succeeded: TSucceeded[];
    skippedBusy: string[];
    skippedReadonly: string[];
    conflicts: string[];
    failed: BatchSkillFailure[];
};
export type SkillLockPort = {
    acquireScopeLock(scopeKey: string, timeoutMs: number): Promise<() => Promise<void>>;
    tryAcquireSkillLock(skillKey: string, timeoutMs: number): Promise<(() => Promise<void>) | null>;
};
export declare class InMemoryHierarchicalLockManager implements SkillLockPort {
    private readonly scopeQueues;
    private readonly heldScopes;
    private readonly heldSkills;
    acquireScopeLock(scopeKey: string, timeoutMs: number): Promise<() => Promise<void>>;
    tryAcquireSkillLock(skillKey: string, timeoutMs: number): Promise<(() => Promise<void>) | null>;
}
/**
 * Two-level deadlock-free batch coordinator (Architect §3.3):
 * Level-1 scope mutex lock + Level-2 lexicographically ordered per-skill locks.
 * Isolates per-skill failures so one error never aborts unrelated skills.
 */
export declare class BatchCoordinator {
    private readonly locks;
    constructor(locks?: SkillLockPort);
    executePerSkill<TItem, TSucceeded>(input: {
        scopeKey: string;
        items: readonly TItem[];
        getSkillId: (item: TItem) => string;
        isConflict?: (item: TItem) => boolean;
        isReadonly?: (item: TItem) => Promise<boolean> | boolean;
        runItem: (item: TItem) => Promise<TSucceeded>;
        scopeTimeoutMs?: number;
        skillTimeoutMs?: number;
    }): Promise<BatchOperationReport<TSucceeded>>;
}
