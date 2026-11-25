export { classifySkillInstallFailureCode, SKILL_INSTALL_BUSY_FAILURE, SKILL_INSTALL_CANCELLED_FAILURE, SKILL_INSTALL_RPC_ERROR_CODE, SkillInstallFailureCategorySchema, SkillInstallFailureSchema, type SkillInstallFailure, type SkillInstallFailureCategory } from './skill-install-failure';
import type { SkillInstallFailure } from './skill-install-failure';
export type SkillPlacementResult = {
    provider: string;
    path: string;
    topology: 'canonical-copy' | 'provider-alias' | 'independent-copy';
    status: 'installed' | 'unchanged' | 'removed' | 'skipped' | 'failed';
    errorCategory?: string;
    failure?: SkillInstallFailure;
};
