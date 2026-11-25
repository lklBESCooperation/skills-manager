import { z } from 'zod';
import { type SkillPathSemantics } from './skill-path-containment';
import type { TuiAgent } from './tui-agent';
export declare const PluginSkillSourceCategorySchema: z.ZodEnum<{
    "bundled-readonly": "bundled-readonly";
    plugin: "plugin";
}>;
export type PluginSkillSourceCategory = z.infer<typeof PluginSkillSourceCategorySchema>;
export declare const PluginSkillActivationStateSchema: z.ZodEnum<{
    active: "active";
    "disabled-in-settings": "disabled-in-settings";
    "project-scoped-inactive": "project-scoped-inactive";
    unknown: "unknown";
    "wsl-unavailable": "wsl-unavailable";
}>;
export type PluginSkillActivationState = z.infer<typeof PluginSkillActivationStateSchema>;
export declare const PluginSkillScopeSchema: z.ZodEnum<{
    local: "local";
    project: "project";
    user: "user";
}>;
export type PluginSkillScope = z.infer<typeof PluginSkillScopeSchema>;
export type PluginSkillRecord = {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly readonly: true;
    readonly sourceCategory: PluginSkillSourceCategory;
    readonly pluginId: string;
    readonly pluginName: string;
    readonly marketplace?: string;
    readonly agent: TuiAgent;
    readonly scope: PluginSkillScope;
    readonly installPath: string;
    readonly skillDirectoryPath: string;
    readonly skillFilePath: string;
    readonly invocationCommand?: string;
    readonly activationState: PluginSkillActivationState;
    readonly digest?: string;
    readonly updatedAt?: number | null;
};
/**
 * Static path marker segments that are ALWAYS readonly plugin/bundled skill domains.
 * Checked lexically (and after realpath) to prevent any write/adopt/enablement/delete/pack mutation.
 */
export declare const STATIC_READONLY_SKILL_MARKERS: readonly string[];
export declare const READONLY_SKILL_ERROR_CODE: 'skill-readonly-plugin-protected';
export type ReadonlyRootFenceContext = {
    readonly readonlyRoots?: readonly string[];
    readonly semantics?: SkillPathSemantics;
};
export declare function isStaticReadonlySkillPath(targetPath: string, semantics?: SkillPathSemantics): boolean;
export declare function isPathInsideReadonlyRoots(targetPath: string, context?: ReadonlyRootFenceContext): boolean;
