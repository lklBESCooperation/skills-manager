import { type SkillInstallProviderId } from '../contracts/skill-install-providers';
export type OrcaSkillProviderId = SkillInstallProviderId;
export type SkillProviderDestination = {
    provider: OrcaSkillProviderId;
    readsCanonicalRoot: boolean;
    rootPath: string;
};
export type SkillProviderRootOverrides = Partial<Record<OrcaSkillProviderId, string>>;
export declare function resolveSkillProviderDestinations(input: {
    scope: 'global' | 'workspace';
    homeDirectory: string;
    workspaceDirectory?: string;
    detectedProviders: readonly string[];
    providerRootOverrides?: SkillProviderRootOverrides;
}): SkillProviderDestination[];
