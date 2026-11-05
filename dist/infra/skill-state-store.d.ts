import type { SkillPlacementResult } from '../contracts/skill-install-contract-types';
export type SkillInstalledFileMode = {
    path: string;
    executable: boolean;
};
export type SkillInstallReceiptV1 = {
    schemaVersion: 1;
    packageId: string;
    versionId: string;
    packageDigest: string;
    bundleDigest?: string;
    archiveSha256: string;
    scope: 'global' | 'workspace';
    destinationIdentity: string;
    canonicalPath: string;
    placements: SkillPlacementResult[];
    providers?: string[];
    previousVersionId?: string;
    installedAt: string;
    hostIdentity: string;
    fileModes?: SkillInstalledFileMode[];
    wslDistro?: string;
};
export declare function skillInstallStateKey(canonicalPath: string): string;
export declare function skillInstallReceiptPath(stateDirectory: string, canonicalPath: string): string;
export declare function writeSkillStateFile(path: string, value: unknown): Promise<void>;
export declare function writeSkillInstallReceipt(stateDirectory: string, receipt: SkillInstallReceiptV1): Promise<void>;
export declare function readSkillInstallReceipt(stateDirectory: string, canonicalPath: string): Promise<SkillInstallReceiptV1 | null>;
