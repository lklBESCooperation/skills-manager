export type SkillBundleFileIdentity = {
    path: string;
    size: number;
    executable: boolean;
    classification: 'text' | 'binary';
    exactSha256: string;
    textNormalizedSha256: string | null;
    identitySha256: string;
};
type ObservedSkillFile = SkillBundleFileIdentity;
export type ObservedSkillPackage = {
    files: ObservedSkillFile[];
    observedDigest: string;
};
export declare function observedSkillPackagesMatch(left: ObservedSkillPackage, right: ObservedSkillPackage): boolean;
export declare function isOsMetadataSkillEntryName(name: string): boolean;
export declare const SKILL_PACKAGE_OBSERVATION_LIMITS: {
    readonly maximumDepth: 16;
    readonly maximumEntries: 2048;
    readonly maximumFiles: 512;
    readonly maximumSingleFileBytes: number;
    readonly maximumTotalBytes: number;
};
type SkillPackageObservationLimits = {
    maximumDepth: number;
    maximumEntries: number;
    maximumFiles: number;
    maximumSingleFileBytes: number;
    maximumTotalBytes: number;
};
export declare function describeObservedSkillFile(path: string, bytes: Buffer, executable: boolean): ObservedSkillFile;
export declare function skillPackageDigest(files: readonly SkillBundleFileIdentity[]): string;
export declare function observeSkillPackage(packageRoot: string, limits?: SkillPackageObservationLimits, executablePaths?: ReadonlySet<string>, signal?: AbortSignal, platform?: NodeJS.Platform, inferShebangExecutables?: boolean): Promise<ObservedSkillPackage>;
/** Require every bundled file identity; tolerate extra agent metadata such as agents/openai.yaml beside unchanged official bytes. */
export declare function matchesBundledSkillFiles(observed: ObservedSkillPackage, expectedFiles: readonly SkillBundleFileIdentity[]): boolean;
export {};
