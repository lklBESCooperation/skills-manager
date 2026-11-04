// Type extraction from src/shared/skill-install-contract.ts and
// src/shared/skill-install-failure.ts (upstream-shared). Re-sync on edits.
export type SkillInstallFailureCategory =
  | 'filesystem'
  | 'network'
  | 'validation'
  | 'conflict'
  | 'cancelled'
  | 'unknown'

export type SkillInstallFailure = {
  category: SkillInstallFailureCategory
  code: string
  retryable: boolean
}

export type SkillPlacementResult = {
  provider: string
  path: string
  topology: 'canonical-copy' | 'provider-alias' | 'independent-copy'
  status: 'installed' | 'unchanged' | 'removed' | 'skipped' | 'failed'
  errorCategory?: string
  failure?: SkillInstallFailure
}
