import { type SkillPackExportBundle, type SkillPackPreviewDiff, type SkillPackReadResult, type SkillPackScope, type SkillPackUndoSnapshot, type SkillPackV2 } from '../contracts/skill-pack-contract';
import { type DynamicPackHitEntry } from './skill-pack-dynamic';
import { type SkillPackMode, type SkillPackPreview } from './skill-pack-preview';
import type { SkillVaultEntryLike } from './skill-pack-rule-eval';
export declare function skillPackFilePath(scope: SkillPackScope, home: string, project?: string): string;
export declare function skillPackUndoRingPath(packsFilePath: string): string;
export declare function readSkillPacks(path: string): Promise<SkillPackReadResult>;
export declare class SkillPackService<T = unknown> {
    private readonly path;
    private readonly dependencies;
    constructor(path: string, dependencies: {
        getCurrent: () => Promise<ReadonlySet<string>>;
        getInstalled: () => Promise<ReadonlySet<string>>;
        onApplyDiff: (plan: SkillPackPreview) => Promise<T>;
        getEntries?: () => Promise<readonly SkillVaultEntryLike[]>;
        isReadonlySkillId?: (id: string) => Promise<boolean> | boolean;
        undoRingPath?: string;
        scope?: SkillPackScope;
    });
    private get undoPath();
    list(): Promise<SkillPackReadResult & {
        entries: {
            pack: SkillPackV2;
            missing: string[];
        }[];
    }>;
    save(pack: SkillPackV2, dryRun?: boolean): Promise<SkillPackV2>;
    saveCurrent(input: {
        id: string;
        name: string;
        description?: string;
    }, dryRun?: boolean): Promise<SkillPackV2>;
    delete(id: string, dryRun?: boolean): Promise<boolean>;
    /** Unified preview for both static and dynamic packs (D-8 merge). */
    preview(id: string, mode: SkillPackMode): Promise<{
        preview: SkillPackPreview;
        diff: SkillPackPreviewDiff;
        hitIds?: string[];
        hitEntries?: DynamicPackHitEntry[];
    }>;
    /** Unified apply for both static and dynamic packs, recording a pre-apply Undo snapshot. */
    apply(id: string, mode: SkillPackMode, dryRun?: boolean): Promise<{
        preview: SkillPackPreview;
        hitIds?: string[];
        hitEntries?: DynamicPackHitEntry[];
        undoId?: string;
        result?: T;
    }>;
    listUndoSnapshots(): Promise<SkillPackUndoSnapshot[]>;
    rollback(undoId?: string): Promise<{
        snapshot: SkillPackUndoSnapshot;
        result: T;
    }>;
    exportPack(id: string, cloudRefs?: SkillPackExportBundle['cloudRefs']): Promise<SkillPackExportBundle>;
    importPack(rawBundle: unknown, options?: {
        conflictStrategy?: 'overwrite' | 'rename' | 'reject';
    }): Promise<{
        pack: SkillPackV2;
        missing: string[];
    }>;
    private resolveEntries;
    private recordUndoSnapshot;
}
