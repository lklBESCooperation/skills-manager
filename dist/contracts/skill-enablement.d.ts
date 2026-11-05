import { z } from 'zod';
/** Tri-state override: project entries may fall back through `inherit` to the user default. */
export type SkillOverride = 'inherit' | 'enabled' | 'disabled';
export type EffectiveSkillState = 'enabled' | 'disabled';
export type SkillEnablementOrigin = 'user' | 'project';
export type EffectiveSkillResolution = {
    effective: EffectiveSkillState;
    origin: SkillEnablementOrigin;
};
export declare const SKILL_ENABLEMENT_SCHEMA_VERSION: 1;
export declare const SKILL_OVERRIDE_VALUES: readonly ['inherit', 'enabled', 'disabled'];
export declare const SKILL_EFFECTIVE_VALUES: readonly ['enabled', 'disabled'];
export declare const SkillOverrideSchema: z.ZodEnum<{
    disabled: "disabled";
    enabled: "enabled";
    inherit: "inherit";
}>;
export declare const SkillEffectiveStateSchema: z.ZodEnum<{
    disabled: "disabled";
    enabled: "enabled";
}>;
export declare const SKILL_ENABLEMENT_STATE_DIRNAME = ".pmstudio";
export declare const SKILL_USER_DEFAULTS_FILENAME = "skills-user-defaults.json";
export declare const SKILL_PROJECT_STATE_FILENAME = "skills-state.json";
export type SkillUserDefaults = Record<string, EffectiveSkillState>;
export type SkillProjectOverrides = Record<string, SkillOverride>;
export type SkillUserDefaultsFileValue = {
    schemaVersion: typeof SKILL_ENABLEMENT_SCHEMA_VERSION;
    defaults: SkillUserDefaults;
};
export type SkillProjectStateFileValue = {
    schemaVersion: typeof SKILL_ENABLEMENT_SCHEMA_VERSION;
    overrides: SkillProjectOverrides;
};
export type SkillEnablementSalvage = {
    collectDrops: <T>(parse: () => T) => {
        value: T;
        droppedPaths: string[];
    };
    salvagingRecord: <V extends z.ZodType>(key: z.ZodType<string>, value: V) => z.ZodType<Record<string, z.output<V>>, unknown>;
};
export type SalvagedSkillEnablementFile<T> = {
    value: T;
    droppedKeys: string[];
    /** Bytes existed but no usable envelope recovered; the file then reads as empty rather than fatal. */
    unreadable: boolean;
};
export declare function parseSkillUserDefaultsFile(raw: string | null, salvage: SkillEnablementSalvage): SalvagedSkillEnablementFile<SkillUserDefaults>;
export declare function parseSkillProjectStateFile(raw: string | null, salvage: SkillEnablementSalvage): SalvagedSkillEnablementFile<SkillProjectOverrides>;
/** Deterministic key order keeps the git-committed project state file diff-stable. */
export declare function skillUserDefaultsFileValue(defaults: Readonly<SkillUserDefaults>): SkillUserDefaultsFileValue;
export declare function skillProjectStateFileValue(overrides: Readonly<SkillProjectOverrides>): SkillProjectStateFileValue;
/**
 * Final effective state per installed skill: project override wins, `inherit` and absence fall
 * back to the user default, and an absent user default keeps the install-is-enabled default.
 * Keys naming skills outside `installed` are ignored by construction.
 */
export declare function resolveEffectiveSkills(input: {
    installed: readonly string[];
    userDefaults: Readonly<Record<string, EffectiveSkillState | undefined>>;
    projectOverrides: Readonly<Record<string, SkillOverride | undefined>>;
}): Map<string, EffectiveSkillResolution>;
