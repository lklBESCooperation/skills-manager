/** Use the file-owning host's semantics: WSL is POSIX even in a win32 process, and remote hosts have their own platform. */
export type SkillPathSemantics = { caseSensitive: boolean; sep: '/' | '\\' }

export const POSIX_SKILL_PATH_SEMANTICS: SkillPathSemantics = { caseSensitive: true, sep: '/' }
export const WINDOWS_SKILL_PATH_SEMANTICS: SkillPathSemantics = { caseSensitive: false, sep: '\\' }

/** Semantics of the process's own filesystem without importing `node:*` modules. */
export function nativeSkillPathSemantics(platform?: string): SkillPathSemantics {
  const detected =
    platform ?? (globalThis as { process?: { platform?: string } }).process?.platform ?? 'linux'
  return detected === 'win32' ? WINDOWS_SKILL_PATH_SEMANTICS : POSIX_SKILL_PATH_SEMANTICS
}

function collapseSegments(segments: readonly string[], allowLeadingDotDot: boolean): string[] {
  const stack: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue
    }
    if (segment === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop()
      } else if (allowLeadingDotDot) {
        stack.push('..')
      }
      continue
    }
    stack.push(segment)
  }
  return stack
}

function splitWin32Root(rawPath: string): { root: string; rest: string } {
  const slashed = rawPath.replace(/\//g, '\\')
  if (slashed.startsWith('\\\\')) {
    // UNC path: \\server\share\...
    const withoutPrefix = slashed.slice(2)
    const parts = withoutPrefix.split('\\').filter(Boolean)
    if (parts.length >= 2) {
      const root = `\\\\${parts[0]}\\${parts[1]}\\`
      const rest = parts.slice(2).join('\\')
      return { root, rest }
    }
    return { root: '\\\\', rest: withoutPrefix }
  }
  if (/^[A-Za-z]:/.test(slashed)) {
    const drive = slashed.slice(0, 2)
    const afterDrive = slashed.slice(2)
    if (afterDrive.startsWith('\\')) {
      return { root: `${drive}\\`, rest: afterDrive.slice(1) }
    }
    return { root: drive, rest: afterDrive }
  }
  if (slashed.startsWith('\\')) {
    return { root: '\\', rest: slashed.slice(1) }
  }
  return { root: '', rest: slashed }
}

function resolvePure(rawPath: string, semantics: SkillPathSemantics): string {
  if (semantics.sep === '\\') {
    const { root, rest } = splitWin32Root(rawPath)
    const isAbs = root.endsWith('\\')
    const segments = collapseSegments(rest.split('\\'), !isAbs)
    if (!root) {
      return segments.length > 0 ? segments.join('\\') : '.'
    }
    if (isAbs) {
      return `${root}${segments.join('\\')}`
    }
    return segments.length > 0 ? `${root}${segments.join('\\')}` : root
  }

  const isAbs = rawPath.startsWith('/')
  const segments = collapseSegments(rawPath.split('/'), !isAbs)
  if (isAbs) {
    return `/${segments.join('/')}`
  }
  return segments.length > 0 ? segments.join('/') : '.'
}

function comparable(path: string, semantics: SkillPathSemantics): string {
  const resolved = resolvePure(path, semantics)
  return semantics.caseSensitive ? resolved : resolved.toLocaleLowerCase('en-US')
}

export function normalizedSkillPath(path: string, semantics: SkillPathSemantics): string {
  return comparable(path, semantics)
}

export function skillPathsEqual(
  left: string,
  right: string,
  semantics: SkillPathSemantics
): boolean {
  return comparable(left, semantics) === comparable(right, semantics)
}

/** True when `path` sits strictly below `root`; the root itself is not inside. */
export function skillPathInside(
  root: string,
  path: string,
  semantics: SkillPathSemantics
): boolean {
  return relativeInside(root, path, semantics) !== null
}

/** Segment count of `path` below `root`; null when `path` is not inside `root`. */
export function skillPathDepthBelow(
  root: string,
  path: string,
  semantics: SkillPathSemantics
): number | null {
  const child = relativeInside(root, path, semantics)
  return child === null ? null : child.split(semantics.sep).length
}

function relativeInside(root: string, path: string, semantics: SkillPathSemantics): string | null {
  const normRoot = comparable(root, semantics)
  const normPath = comparable(path, semantics)
  if (normRoot === normPath) {
    return null
  }
  const sep = semantics.sep
  if (semantics.sep === '\\') {
    const rootParts = splitWin32Root(normRoot)
    const pathParts = splitWin32Root(normPath)
    if (rootParts.root !== pathParts.root) {
      return null
    }
    const prefix = normRoot.endsWith('\\') ? normRoot : `${normRoot}\\`
    if (!normPath.startsWith(prefix)) {
      return null
    }
    const child = normPath.slice(prefix.length)
    return child.length > 0 ? child : null
  }
  const prefix = normRoot === '/' ? '/' : `${normRoot}${sep}`
  if (!normPath.startsWith(prefix)) {
    return null
  }
  const child = normPath.slice(prefix.length)
  return child.length > 0 ? child : null
}
