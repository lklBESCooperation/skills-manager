/** Use the file-owning host’s semantics: WSL is POSIX even in a win32 process, and remote hosts have their own platform. */
export type SkillPathSemantics = {
    caseSensitive: boolean;
    sep: '/' | '\\';
};
export declare const POSIX_SKILL_PATH_SEMANTICS: SkillPathSemantics;
export declare const WINDOWS_SKILL_PATH_SEMANTICS: SkillPathSemantics;
/** Semantics of the process's own filesystem. */
export declare function nativeSkillPathSemantics(platform?: NodeJS.Platform): SkillPathSemantics;
export declare function normalizedSkillPath(path: string, semantics: SkillPathSemantics): string;
export declare function skillPathsEqual(left: string, right: string, semantics: SkillPathSemantics): boolean;
/** True when `path` sits strictly below `root`; the root itself is not inside. */
export declare function skillPathInside(root: string, path: string, semantics: SkillPathSemantics): boolean;
/** Segment count of `path` below `root`; null when `path` is not inside `root`. */
export declare function skillPathDepthBelow(root: string, path: string, semantics: SkillPathSemantics): number | null;
