import { type ReadonlyRootFenceContext } from '../contracts/plugin-skill-contract';
import type { SkillInstallFailure } from '../contracts/skill-install-failure';
export declare class ReadonlySkillProtectedError extends Error {
    readonly code: "skill-readonly-plugin-protected";
    readonly targetPath: string;
    readonly resolvedPath: string | null;
    readonly failure: SkillInstallFailure;
    constructor(targetPath: string, resolvedPath?: string | null);
}
/**
 * Dual-layer write fence: blocks any target whose lexical path OR resolved realpath sits
 * inside static plugin/bundled prefixes or dynamic plugin installation roots.
 */
export declare function assertWritableSkillTarget(targetPath: string, context?: ReadonlyRootFenceContext): Promise<void>;
export declare function isReadonlySkillTarget(targetPath: string, context?: ReadonlyRootFenceContext): Promise<boolean>;
