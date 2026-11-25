import { join, resolve } from 'node:path'

// ② skills vault roots (PRD §2.1). Same normalization semantics as
// skill-provider-destinations.ts so path comparisons never drift by platform.

export function normalizedSkillVaultPath(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

export function userSkillVaultRoot(homeDirectory: string): string {
  return join(homeDirectory, '.pmstudio', 'skills')
}

export function userSkillVaultIndexPath(homeDirectory: string): string {
  return join(homeDirectory, '.pmstudio', 'skills-index.json')
}

export function projectSkillVaultRoot(workspaceDirectory: string): string {
  return join(workspaceDirectory, '.pmstudio', 'skills')
}

/** Symmetric with `userSkillVaultIndexPath`: `<ws>/.pmstudio/skills-index.json` (D-5). */
export function projectSkillVaultIndexPath(workspaceDirectory: string): string {
  return join(workspaceDirectory, '.pmstudio', 'skills-index.json')
}

/** Legacy pre-v0.2 location kept strictly for read-only migration fallback. */
export function legacyProjectSkillVaultIndexPath(workspaceDirectory: string): string {
  return join(workspaceDirectory, '.pmstudio', 'skills', 'skills-index.json')
}

export function skillVaultEntryRoot(vaultRoot: string, id: string): string {
  return join(vaultRoot, id)
}
