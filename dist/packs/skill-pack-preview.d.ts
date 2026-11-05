export type SkillPackMode = 'apply' | 'switch';
export type SkillPackPreview = {
    enable: Set<string>;
    disable: Set<string>;
    keep: Set<string>;
    missing: Set<string>;
};
export declare function previewSkillPack(input: {
    current: ReadonlySet<string>;
    members: ReadonlySet<string>;
    installed: ReadonlySet<string>;
    mode: SkillPackMode;
}): SkillPackPreview;
