import { randomUUID } from 'node:crypto'
import { lstat, mkdir, opendir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import {
  renderSkillMarkdownTemplate,
  SkillCreateWizardInputSchema,
  validateSkillFrontmatter,
  validateSkillId,
  type SkillCreateWizardInput,
  type SkillEditorFileEntry
} from '../contracts/skill-editor-contract'
import { summarizeSkillMarkdown } from '../contracts/skill-metadata'
import {
  nativeSkillPathSemantics,
  skillPathInside,
  skillPathsEqual
} from '../contracts/skill-path-containment'
import type { SkillVaultEntry, SkillVaultIndex } from '../contracts/skill-vault-contract'
import { assertWritableSkillTarget } from '../infra/readonly-root-fence'
import { renameSkillPathWithWindowsRetry } from '../infra/skill-filesystem-retry'
import {
  computeSkillVaultDigest,
  readSkillVaultIndex,
  rebuildSkillVaultIndex,
  skillVaultSizeBytes
} from '../vault/skill-vault-index-service'
import { skillVaultEntryRoot } from '../vault/skill-vault-paths'
import { SKILL_VAULT_STAGE_MARKER } from '../vault/staging-marker'

export type SkillEditorScopeOptions = {
  vaultRoot: string
  indexPath: string
  readonlyRoots?: readonly string[]
}

function assertValidSkillId(skillId: string): void {
  if (!validateSkillId(skillId)) {
    throw new Error(`skill-editor-invalid-id: ${skillId}`)
  }
}

async function resolveSkillRoot(
  vaultRoot: string,
  skillId: string,
  readonlyRoots?: readonly string[]
): Promise<{ lexicalRoot: string; realRoot: string }> {
  assertValidSkillId(skillId)
  const semantics = nativeSkillPathSemantics()
  const lexicalRoot = skillVaultEntryRoot(vaultRoot, skillId)
  if (!skillPathInside(vaultRoot, lexicalRoot, semantics)) {
    throw new Error(`skill-path-escape: ${skillId}`)
  }
  await assertWritableSkillTarget(lexicalRoot, { readonlyRoots, semantics })
  const realRoot = await realpath(lexicalRoot).catch(() => resolve(lexicalRoot))
  return { lexicalRoot, realRoot }
}

/**
 * Resolves `relativePath` inside a skill directory and blocks lexical `..`, absolute
 * paths, symlinks escaping the skill directory, and readonly plugin targets.
 */
async function resolveContainmentPath(input: {
  vaultRoot: string
  skillId: string
  relativePath: string
  readonlyRoots?: readonly string[]
  allowMissingTarget?: boolean
}): Promise<string> {
  const { lexicalRoot, realRoot } = await resolveSkillRoot(
    input.vaultRoot,
    input.skillId,
    input.readonlyRoots
  )
  const normalizedRel = input.relativePath.replace(/\\/g, '/')
  if (
    !normalizedRel ||
    normalizedRel.startsWith('/') ||
    /^[A-Za-z]:/.test(normalizedRel) ||
    normalizedRel.includes('\0')
  ) {
    throw new Error(`skill-path-escape: ${input.relativePath}`)
  }

  const candidate = resolve(lexicalRoot, normalizedRel)
  const semantics = nativeSkillPathSemantics()
  if (!skillPathInside(lexicalRoot, candidate, semantics)) {
    throw new Error(`skill-path-escape: ${input.relativePath}`)
  }
  await assertWritableSkillTarget(candidate, { readonlyRoots: input.readonlyRoots, semantics })

  // Walk existing path or nearest existing ancestor to ensure no symlink escapes `realRoot`.
  const targetStat = await lstat(candidate).catch(() => null)
  if (targetStat) {
    if (targetStat.isSymbolicLink()) {
      const targetReal = await realpath(candidate).catch(() => null)
      if (!targetReal || !skillPathInside(realRoot, targetReal, semantics)) {
        throw new Error(`skill-path-escape: symlink ${input.relativePath}`)
      }
    } else {
      const targetReal = await realpath(candidate)
      if (!skillPathInside(realRoot, targetReal, semantics) && !skillPathsEqual(realRoot, targetReal, semantics)) {
        throw new Error(`skill-path-escape: ${input.relativePath}`)
      }
    }
  } else {
    if (!input.allowMissingTarget) {
      throw new Error(`skill-editor-not-found: ${input.relativePath}`)
    }
    let cursor = dirname(candidate)
    while (!skillPathsEqual(cursor, lexicalRoot, semantics)) {
      const ancestorStat = await lstat(cursor).catch(() => null)
      if (ancestorStat) {
        const ancestorReal = await realpath(cursor).catch(() => null)
        if (
          !ancestorReal ||
          (!skillPathInside(realRoot, ancestorReal, semantics) &&
            !skillPathsEqual(realRoot, ancestorReal, semantics))
        ) {
          throw new Error(`skill-path-escape: ancestor symlink ${input.relativePath}`)
        }
        break
      }
      const nextParent = dirname(cursor)
      if (nextParent === cursor) {
        throw new Error(`skill-path-escape: ${input.relativePath}`)
      }
      cursor = nextParent
    }
  }

  return candidate
}

async function syncVaultEntryAfterEdit(
  scope: SkillEditorScopeOptions,
  skillId: string
): Promise<SkillVaultIndex | null> {
  const index = await readSkillVaultIndex(scope.indexPath)
  const vaultPath = skillVaultEntryRoot(scope.vaultRoot, skillId)
  const markdown = await readFile(join(vaultPath, 'SKILL.md'), 'utf8').catch(() => '')
  const summary = summarizeSkillMarkdown(markdown)
  const digest = await computeSkillVaultDigest(vaultPath)
  const sizeBytes = await skillVaultSizeBytes(vaultPath).catch(() => 0)
  const now = new Date().toISOString()

  const existing = index?.entries.find((item) => item.id === skillId)
  const updatedEntry: SkillVaultEntry = existing
    ? {
        ...existing,
        name: summary.name ?? existing.name,
        description: summary.description,
        digest,
        sizeBytes,
        updatedAt: now
      }
    : {
        id: skillId,
        name: summary.name ?? skillId,
        description: summary.description,
        sourceKind: 'installed',
        originPath: null,
        linkPaths: [],
        digest,
        sizeBytes,
        tags: [],
        author: null,
        installedAt: now,
        updatedAt: now
      }

  const nextEntries = [
    ...(index?.entries ?? []).filter((item) => item.id !== skillId),
    updatedEntry
  ]
  return rebuildSkillVaultIndex(scope.indexPath, nextEntries)
}

export async function listSkillFiles(
  scope: SkillEditorScopeOptions,
  skillId: string
): Promise<SkillEditorFileEntry[]> {
  const { lexicalRoot, realRoot } = await resolveSkillRoot(
    scope.vaultRoot,
    skillId,
    scope.readonlyRoots
  )
  const semantics = nativeSkillPathSemantics()
  const entries: SkillEditorFileEntry[] = []

  async function walk(dir: string): Promise<void> {
    const handle = await opendir(dir)
    const dirents = []
    try {
      for (;;) {
        const d = await handle.read()
        if (!d) break
        dirents.push(d)
      }
    } finally {
      await handle.close().catch(() => undefined)
    }
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const d of dirents) {
      const full = join(dir, d.name)
      const st = await lstat(full)
      if (st.isSymbolicLink()) {
        const real = await realpath(full).catch(() => null)
        if (!real || !skillPathInside(realRoot, real, semantics)) {
          continue
        }
      }
      const rel = relative(lexicalRoot, full).replace(/\\/g, '/')
      if (st.isDirectory()) {
        entries.push({ relativePath: rel, kind: 'directory', sizeBytes: 0 })
        await walk(full)
      } else if (st.isFile()) {
        entries.push({ relativePath: rel, kind: 'file', sizeBytes: st.size })
      }
    }
  }

  await walk(lexicalRoot)
  return entries
}

export async function readSkillFile(
  scope: SkillEditorScopeOptions,
  skillId: string,
  relativePath: string
): Promise<string> {
  const target = await resolveContainmentPath({
    vaultRoot: scope.vaultRoot,
    skillId,
    relativePath,
    readonlyRoots: scope.readonlyRoots,
    allowMissingTarget: false
  })
  return readFile(target, 'utf8')
}

export async function writeSkillFile(
  scope: SkillEditorScopeOptions,
  skillId: string,
  relativePath: string,
  content: string,
  options?: { validateFrontmatter?: boolean }
): Promise<{ path: string; digest: string }> {
  const normalizedRel = relativePath.replace(/\\/g, '/')
  if (normalizedRel === 'SKILL.md' && options?.validateFrontmatter !== false) {
    const validation = validateSkillFrontmatter(content)
    if (!validation.valid) {
      throw new Error(`skill-editor-invalid-frontmatter: ${validation.errors.join('; ')}`)
    }
  }
  const target = await resolveContainmentPath({
    vaultRoot: scope.vaultRoot,
    skillId,
    relativePath,
    readonlyRoots: scope.readonlyRoots,
    allowMissingTarget: true
  })
  await mkdir(dirname(target), { recursive: true })
  const temp = `${target}.${randomUUID()}.tmp`
  await writeFile(temp, content, 'utf8')
  try {
    await renameSkillPathWithWindowsRetry(temp, target)
  } finally {
    await rm(temp, { force: true }).catch(() => undefined)
  }
  await syncVaultEntryAfterEdit(scope, skillId)
  const digest = await computeSkillVaultDigest(skillVaultEntryRoot(scope.vaultRoot, skillId))
  return { path: target, digest }
}

export async function deleteSkillFile(
  scope: SkillEditorScopeOptions,
  skillId: string,
  relativePath: string
): Promise<void> {
  const normalizedRel = relativePath.replace(/\\/g, '/')
  if (normalizedRel === 'SKILL.md') {
    throw new Error('skill-editor-cannot-delete-skill-md')
  }
  const target = await resolveContainmentPath({
    vaultRoot: scope.vaultRoot,
    skillId,
    relativePath,
    readonlyRoots: scope.readonlyRoots,
    allowMissingTarget: false
  })
  await rm(target, { recursive: true, force: true })
  await syncVaultEntryAfterEdit(scope, skillId)
}

export async function createLocalSkillInVault(
  scope: SkillEditorScopeOptions,
  input: SkillCreateWizardInput,
  extraFiles?: readonly { relativePath: string; content: string }[]
): Promise<{ id: string; vaultPath: string; index: SkillVaultIndex | null }> {
  const parsed = SkillCreateWizardInputSchema.parse(input)
  assertValidSkillId(parsed.id)
  const semantics = nativeSkillPathSemantics()
  const vaultPath = skillVaultEntryRoot(scope.vaultRoot, parsed.id)
  await assertWritableSkillTarget(vaultPath, {
    readonlyRoots: scope.readonlyRoots,
    semantics
  })

  const exists = await lstat(vaultPath).catch(() => null)
  if (exists) {
    throw new Error(`skill-install-conflict: ${parsed.id}`)
  }

  await mkdir(scope.vaultRoot, { recursive: true })
  const stagePath = join(
    scope.vaultRoot,
    `.${parsed.id}${SKILL_VAULT_STAGE_MARKER}${randomUUID()}`
  )
  try {
    await mkdir(stagePath, { recursive: true })
    const markdown = renderSkillMarkdownTemplate(parsed)
    const validation = validateSkillFrontmatter(markdown)
    if (!validation.valid) {
      throw new Error(`skill-editor-invalid-frontmatter: ${validation.errors.join('; ')}`)
    }
    await writeFile(join(stagePath, 'SKILL.md'), markdown, 'utf8')
    if (extraFiles) {
      for (const extra of extraFiles) {
        const rel = extra.relativePath.replace(/\\/g, '/')
        if (!rel || rel.startsWith('/') || rel.split('/').some((seg) => seg === '..' || seg === '.')) {
          throw new Error(`skill-path-escape: ${extra.relativePath}`)
        }
        const full = resolve(stagePath, rel)
        if (!skillPathInside(stagePath, full, semantics)) {
          throw new Error(`skill-path-escape: ${extra.relativePath}`)
        }
        await mkdir(dirname(full), { recursive: true })
        await writeFile(full, extra.content, 'utf8')
      }
    }
    await renameSkillPathWithWindowsRetry(stagePath, vaultPath)
    const index = await syncVaultEntryAfterEdit(scope, parsed.id)
    if (index && parsed.tags.length > 0) {
      const updated = index.entries.map((entry) =>
        entry.id === parsed.id
          ? { ...entry, tags: [...parsed.tags], author: parsed.author ?? null }
          : entry
      )
      await rebuildSkillVaultIndex(scope.indexPath, updated)
    }
    return {
      id: parsed.id,
      vaultPath,
      index: await readSkillVaultIndex(scope.indexPath)
    }
  } catch (error) {
    await rm(stagePath, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}
