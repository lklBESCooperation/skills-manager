import { lstat, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  isPathInsideReadonlyRoots,
  READONLY_SKILL_ERROR_CODE,
  type ReadonlyRootFenceContext
} from '../contracts/plugin-skill-contract'
import type { SkillInstallFailure } from '../contracts/skill-install-failure'

export class ReadonlySkillProtectedError extends Error {
  readonly code = READONLY_SKILL_ERROR_CODE
  readonly targetPath: string
  readonly resolvedPath: string | null
  readonly failure: SkillInstallFailure = {
    category: 'admission',
    code: READONLY_SKILL_ERROR_CODE,
    retryable: false
  }

  constructor(targetPath: string, resolvedPath: string | null = null) {
    super(`${READONLY_SKILL_ERROR_CODE}: ${targetPath}`)
    this.name = 'ReadonlySkillProtectedError'
    this.targetPath = targetPath
    this.resolvedPath = resolvedPath
  }
}

async function resolveNormalizedReadonlyRoots(
  roots: readonly string[] | undefined
): Promise<readonly string[]> {
  if (!roots || roots.length === 0) {
    return []
  }
  const resolved = await Promise.all(
    roots.map(async (root) => {
      const real = await realpath(root).catch(() => null)
      return real ? [root, real] : [root]
    })
  )
  return resolved.flat()
}

/**
 * Resolves `targetPath` through symlinks on the target itself or its nearest existing ancestor
 * so symlink penetration into plugin/bundled roots is blocked even before the file exists.
 */
async function resolveTargetRealPath(targetPath: string): Promise<string | null> {
  const direct = await realpath(targetPath).catch(() => null)
  if (direct !== null) {
    return direct
  }
  const abs = resolve(targetPath)
  const missingSegments: string[] = []
  let cursor = abs
  for (;;) {
    const stat = await lstat(cursor).catch(() => null)
    if (stat) {
      const realCursor = await realpath(cursor).catch(() => cursor)
      return missingSegments.length > 0
        ? join(realCursor, ...missingSegments.toReversed())
        : realCursor
    }
    const parent = dirname(cursor)
    if (parent === cursor) {
      return null
    }
    const segment = cursor.slice(parent.length).replace(/^[/\\]+/, '')
    if (segment) {
      missingSegments.push(segment)
    }
    cursor = parent
  }
}

/**
 * Dual-layer write fence: blocks any target whose lexical path OR resolved realpath sits
 * inside static plugin/bundled prefixes or dynamic plugin installation roots.
 */
export async function assertWritableSkillTarget(
  targetPath: string,
  context: ReadonlyRootFenceContext = {}
): Promise<void> {
  const expandedRoots = await resolveNormalizedReadonlyRoots(context.readonlyRoots)
  const effectiveContext: ReadonlyRootFenceContext = {
    ...context,
    readonlyRoots: expandedRoots
  }
  if (isPathInsideReadonlyRoots(targetPath, effectiveContext)) {
    throw new ReadonlySkillProtectedError(targetPath, null)
  }
  const realTarget = await resolveTargetRealPath(targetPath)
  if (realTarget !== null && isPathInsideReadonlyRoots(realTarget, effectiveContext)) {
    throw new ReadonlySkillProtectedError(targetPath, realTarget)
  }
}

export async function isReadonlySkillTarget(
  targetPath: string,
  context: ReadonlyRootFenceContext = {}
): Promise<boolean> {
  try {
    await assertWritableSkillTarget(targetPath, context)
    return false
  } catch (error) {
    if (error instanceof ReadonlySkillProtectedError) {
      return true
    }
    throw error
  }
}
