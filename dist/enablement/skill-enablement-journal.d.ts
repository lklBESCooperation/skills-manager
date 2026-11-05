import type { SkillEnablementPlan } from './skill-enablement-planner';
/** Host-injected bounded reader (upstream src/shared/node-bounded-file-reader); journal reads must cap bytes. */
export type EnablementBoundedFileReader = (filePath: string, maxBytes: number) => Promise<{
    buffer: Buffer;
}>;
export type EnablementJournalAction = {
    kind: 'link' | 'unlink' | 'move-to-canonical' | 'move-to-vault';
    skillId: string;
    provider: string;
    sourcePath: string;
    destinationPath: string;
};
export type ExecutedEnablementStep = {
    skillId: string;
    provider: string;
    action: string;
};
export declare function enablementJournalPath(stateDirectory: string): string;
/** Replay a journal left by an interrupted batch until every action lands or no-ops. */
export declare function recoverEnablementJournal(stateDirectory: string, readFileBounded: EnablementBoundedFileReader): Promise<{
    executed: ExecutedEnablementStep[];
}>;
export declare function journalActionsForPlan(plan: SkillEnablementPlan, vaultRoot: string, canonicalRoot: string): EnablementJournalAction[];
/**
 * Journal-first placement batch: write every action before running any, run moves before
 * links, delete the journal once settled. An interruption leaves the journal so the next
 * run replays to convergence with no half-enabled state.
 */
export declare function applyPlanTransactionally(input: {
    stateDirectory: string;
    plan: SkillEnablementPlan;
    vaultRoot: string;
    canonicalRoot: string;
    /** Test seam: crash after this many actions have run; the journal stays for replay. */
    interruptAfterCount?: number;
}): Promise<ExecutedEnablementStep[]>;
