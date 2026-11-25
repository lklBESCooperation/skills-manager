import { z } from 'zod'
import { declaredSkillMetadata } from './skill-metadata'

export const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const SkillEditorFileEntrySchema = z
  .object({
    relativePath: z.string().min(1),
    kind: z.enum(['file', 'directory']),
    sizeBytes: z.number().int().nonnegative()
  })
  .strict()

export type SkillEditorFileEntry = z.infer<typeof SkillEditorFileEntrySchema>

export const SkillCreateWizardInputSchema = z
  .object({
    id: z.string().regex(SKILL_ID_PATTERN, 'Skill id must be kebab-case'),
    name: z.string().trim().min(1).max(256),
    description: z.string().trim().min(1).max(2048),
    author: z.string().trim().min(1).max(128).optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(32).default([]),
    instructions: z.string().optional()
  })
  .strict()

export type SkillCreateWizardInput = z.input<typeof SkillCreateWizardInputSchema>

export type SkillFrontmatterValidationResult =
  | {
      valid: true
      name: string
      description: string
      warnings: string[]
    }
  | {
      valid: false
      errors: string[]
    }

export function validateSkillId(id: string): boolean {
  return (
    id.length >= 1 &&
    id.length <= 128 &&
    SKILL_ID_PATTERN.test(id) &&
    id !== 'constructor' &&
    id !== 'prototype'
  )
}

export function validateSkillFrontmatter(markdown: string): SkillFrontmatterValidationResult {
  const normalized = markdown.replace(/^\uFEFF/, '')
  const errors: string[] = []
  const warnings: string[] = []
  const frontmatterMatch = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(normalized)
  if (!frontmatterMatch) {
    errors.push('Missing YAML frontmatter block delimited by ---')
    return { valid: false, errors }
  }
  const declared = declaredSkillMetadata(normalized)
  if (!declared) {
    errors.push('YAML frontmatter must declare non-empty `name` and `description` fields')
    return { valid: false, errors }
  }
  if (declared.name.length > 256) {
    errors.push('Frontmatter `name` exceeds 256 characters')
  }
  if (declared.description.length > 2048) {
    errors.push('Frontmatter `description` exceeds 2048 characters')
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(declared.name)) {
    errors.push('Frontmatter `name` contains disallowed control characters')
  }
  const body = normalized.slice(frontmatterMatch[0].length).trim()
  if (body.length === 0) {
    warnings.push('SKILL.md body is empty')
  }
  if (errors.length > 0) {
    return { valid: false, errors }
  }
  return {
    valid: true,
    name: declared.name,
    description: declared.description,
    warnings
  }
}

export function renderSkillMarkdownTemplate(input: SkillCreateWizardInput): string {
  const parsed = SkillCreateWizardInputSchema.parse(input)
  const lines = [
    '---',
    `name: ${parsed.name}`,
    `description: ${parsed.description}`
  ]
  if (parsed.author) {
    lines.push(`author: ${parsed.author}`)
  }
  if (parsed.tags.length > 0) {
    lines.push('tags:')
    for (const tag of parsed.tags) {
      lines.push(`  - ${tag}`)
    }
  }
  lines.push('---', '', `# ${parsed.name}`, '')
  lines.push(parsed.instructions?.trim() || 'Describe when and how an agent should apply this skill.')
  lines.push('')
  return lines.join('\n')
}
