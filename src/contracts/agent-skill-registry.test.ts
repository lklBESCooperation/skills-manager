import { describe, expect, it } from 'vitest'
import {
  AGENT_SKILL_DESCRIPTORS,
  AGENT_SKILL_REGISTRY,
  getAgentBorrowedOwners
} from './agent-skill-registry'
import { SKILL_INSTALL_PROVIDERS } from './skill-install-providers'
import {
  classifySkillInstallFailureCode,
  SkillInstallFailureCategorySchema
} from './skill-install-failure'
import { declaredSkillMetadata } from './skill-metadata'
import { TUI_AGENTS } from './tui-agent'
import {
  legacyProjectSkillVaultIndexPath,
  projectSkillVaultIndexPath,
  userSkillVaultIndexPath
} from '../vault/skill-vault-paths'
import { isSkillStagingEntryName, SKILL_VAULT_STAGE_MARKER } from '../vault/staging-marker'

describe('Phase 0 contract convergence (D-2..D-7)', () => {
  it('covers all 45 TuiAgent values in AGENT_SKILL_REGISTRY and derives 42 install providers', () => {
    expect(TUI_AGENTS).toHaveLength(45)
    expect(AGENT_SKILL_DESCRIPTORS).toHaveLength(45)
    expect(Object.keys(AGENT_SKILL_REGISTRY)).toHaveLength(45)
    expect(SKILL_INSTALL_PROVIDERS).toHaveLength(42)

    expect(AGENT_SKILL_REGISTRY.gemini.installTargets.globalSegments).toBeNull()
    expect(AGENT_SKILL_REGISTRY.gemini.retiredInstallRoots).toEqual([['.gemini', 'skills']])
    expect(SKILL_INSTALL_PROVIDERS.find((p) => p.id === 'gemini')?.globalSegments).toBeNull()

    expect(AGENT_SKILL_REGISTRY['claude-agent-teams'].capability).toBe('delegate')
    expect(AGENT_SKILL_REGISTRY['claude-agent-teams'].delegatesTo).toBe('claude')
    expect(AGENT_SKILL_REGISTRY.hermes.capability).toBe('discovery-only')
    expect(AGENT_SKILL_REGISTRY.aider.capability).toBe('unsupported')
    expect(getAgentBorrowedOwners('opencode', 'global')).toEqual(['claude'])
    expect(getAgentBorrowedOwners('copilot', 'workspace')).toEqual(['claude'])
    expect(getAgentBorrowedOwners('copilot', 'global')).toEqual([])
  })

  it('unifies 9-value SkillInstallFailureCategory (D-3)', () => {
    expect(SkillInstallFailureCategorySchema.options).toEqual([
      'admission',
      'transport',
      'archive',
      'filesystem',
      'conflict',
      'recovery',
      'provider-placement',
      'compatibility',
      'cancelled'
    ])
    expect(classifySkillInstallFailureCode('skill-readonly-plugin-protected')).toEqual({
      category: 'admission',
      code: 'skill-readonly-plugin-protected',
      retryable: false
    })
    expect(classifySkillInstallFailureCode('skill-package-link')).toEqual({
      category: 'archive',
      code: 'skill-package-link',
      retryable: false
    })
  })

  it('aligns .orca-stage- marker (D-4) and symmetric projectSkillVaultIndexPath (D-5)', () => {
    expect(SKILL_VAULT_STAGE_MARKER).toBe('.orca-stage-')
    expect(isSkillStagingEntryName('.foo.orca-stage-123')).toBe(true)
    expect(isSkillStagingEntryName('.foo.pmstage-123')).toBe(true)
    expect(isSkillStagingEntryName('normal-skill')).toBe(false)

    expect(userSkillVaultIndexPath('/home/u')).toBe('/home/u/.pmstudio/skills-index.json')
    expect(projectSkillVaultIndexPath('/ws/repo')).toBe('/ws/repo/.pmstudio/skills-index.json')
    expect(legacyProjectSkillVaultIndexPath('/ws/repo')).toBe(
      '/ws/repo/.pmstudio/skills/skills-index.json'
    )
  })

  it('parses strict declaredSkillMetadata only when both name and description exist in frontmatter (D-7)', () => {
    expect(
      declaredSkillMetadata('---\nname: my-skill\ndescription: Does things\n---\n# Heading\n')
    ).toEqual({
      name: 'my-skill',
      description: 'Does things'
    })
    expect(declaredSkillMetadata('---\nname: only-name\n---\nParagraph\n')).toBeNull()
    expect(declaredSkillMetadata('# No frontmatter\n\nBody\n')).toBeNull()
  })
})
