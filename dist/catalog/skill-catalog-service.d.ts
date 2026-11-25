import { type CatalogInstallRequest, type CatalogLeaderboardQuery, type CatalogPageResult, type CatalogSearchQuery, type CatalogSkillEntry, type CatalogTransportPort, type GitHubInstallSpec } from '../contracts/skill-catalog-contract';
import type { SkillVaultEntry, SkillVaultIndex } from '../contracts/skill-vault-contract';
export type CatalogInstallOutcome = {
    id: string;
    vaultPath: string;
    digest: string;
    sizeBytes: number;
    entry: SkillVaultEntry;
    index: SkillVaultIndex;
};
export declare class SkillCatalogService {
    private readonly transport;
    constructor(transport: CatalogTransportPort);
    leaderboard(query?: CatalogLeaderboardQuery, signal?: {
        readonly aborted: boolean;
    }): Promise<CatalogPageResult>;
    search(query: CatalogSearchQuery, signal?: {
        readonly aborted: boolean;
    }): Promise<CatalogPageResult>;
    installFromCatalog(entry: CatalogSkillEntry, request: CatalogInstallRequest): Promise<CatalogInstallOutcome>;
    installFromGitHub(rawSpec: string | GitHubInstallSpec, request: CatalogInstallRequest, metadata?: {
        author?: string | null;
        tags?: readonly string[];
    }): Promise<CatalogInstallOutcome>;
    private stageAndCommitToVault;
}
