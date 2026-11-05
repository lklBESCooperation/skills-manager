import { type SkillPack, type SkillPackReadResult, type SkillPackScope } from '../contracts/skill-pack-contract';
import { type SkillPackMode, type SkillPackPreview } from './skill-pack-preview';
export declare function skillPackFilePath(scope: SkillPackScope, home: string, project?: string): string;
export declare function readSkillPacks(path: string): Promise<SkillPackReadResult>;
export declare class SkillPackService<T = unknown> {
    private readonly path;
    private readonly dependencies;
    constructor(path: string, dependencies: {
        getCurrent: () => Promise<ReadonlySet<string>>;
        getInstalled: () => Promise<ReadonlySet<string>>;
        onApplyDiff: (plan: SkillPackPreview) => Promise<T>;
    });
    list(): Promise<SkillPackReadResult & {
        entries: {
            pack: SkillPack;
            missing: string[];
        }[];
    }>;
    save(pack: SkillPack, dryRun?: boolean): Promise<SkillPack>;
    saveCurrent(input: {
        id: string;
        name: string;
        description?: string;
    }, dryRun?: boolean): Promise<SkillPack>;
    delete(id: string, dryRun?: boolean): Promise<boolean>;
    apply(id: string, mode: SkillPackMode, dryRun?: boolean): Promise<{
        preview: SkillPackPreview;
        result?: T;
    }>;
}
