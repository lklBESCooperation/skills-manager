import type { SkillEnablementPlan } from './skill-enablement-planner';
export declare const MAX_JOURNAL_ACTIONS = 2000;
/** Host-injected bounded reader (upstream src/shared/node-bounded-file-reader); journal reads must cap bytes. */
export type EnablementBoundedFileReader = (filePath: string, maxBytes: number) => Promise<{
    buffer: Buffer;
}>;
export type EnablementJournalAction = {
    kind: 'link' | 'unlink' | 'copy' | 'remove-copy' | 'adopt-canonical-to-vault';
    skillId: string;
    provider: string;
    sourcePath: string;
    destinationPath: string;
};
/**
 * Compact chunked Journal V2 (Architect §3.3 / Q5):
 * Root path dictionary avoids repeating long directories across thousands of tuples.
 */
export type EnablementJournalTupleOp = 'L' | 'U' | 'C' | 'R' | 'M';
export type EnablementJournalV2 = {
    schemaVersion: 2;
    operation: 'enablement';
    vaultRoot: string;
    canonicalRoot: string;
    chunkIndex: number;
    totalChunks: number;
    providerRoots: Record<string, string>;
    tuples: [op: EnablementJournalTupleOp, skillId: string, providerKey: string][];
};
export type ExecutedEnablementStep = {
    skillId: string;
    provider: string;
    action: string;
};
export declare function enablementJournalPath(stateDirectory: string, chunkIndex?: number): string;
/** Replay any journal (v1 or multi-chunk v2) left by an interrupted batch until convergence. */
export declare function recoverEnablementJournal(stateDirectory: string, readFileBounded: EnablementBoundedFileReader, readonlyRoots?: readonly string[]): Promise<{
    executed: ExecutedEnablementStep[];
}>;
export declare function journalActionsForPlan(plan: SkillEnablementPlan, vaultRoot: string, canonicalRoot: string): EnablementJournalAction[];
export declare function serializeJournalV2Chunks(input: {
    actions: readonly EnablementJournalAction[];
    plan: SkillEnablementPlan;
    vaultRoot: string;
    canonicalRoot: string;
    maxActionsPerChunk?: number;
}): EnablementJournalV2[];
/**
 * Journal-first placement batch using compact chunked EnablementJournalV2:
 * writes every chunk before executing any action, runs Vault migrations before links,
 * and deletes the journal once settled.
 */
export declare function applyPlanTransactionally(input: {
    stateDirectory: string;
    plan: SkillEnablementPlan;
    vaultRoot: string;
    canonicalRoot: string;
    readonlyRoots?: readonly string[];
    maxActionsPerChunk?: number;
    /** Test seam: crash after this many actions have run; the journal stays for replay. */
    interruptAfterCount?: number;
}): Promise<ExecutedEnablementStep[]>;
