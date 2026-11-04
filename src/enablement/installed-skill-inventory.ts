import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Installed-skill inventory: which skill ids exist as manageable directories in the
 * vault or the canonical root. A skill counts when its entry resolves to a directory.
 */

async function listSkillDirectoryIds(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  // Why stat on links: readdir Dirents use lstat, so a symlinked skill (e.g. an
  // external library link in canonical) reports isDirectory()=false and would
  // vanish from the installed set.
  const ids: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue
    }
    const isDirectory =
      entry.isDirectory() ||
      (entry.isSymbolicLink() &&
        ((await stat(join(root, entry.name)).catch(() => null))?.isDirectory() ?? false))
    if (isDirectory) {
      ids.push(entry.name)
    }
  }
  return ids.sort()
}

/** A skill is installed when its master lives in the vault OR already sits in canonical. */
export async function listInstalledSkillIds(
  vaultRoot: string,
  canonicalRoot: string
): Promise<string[]> {
  const [vaultIds, canonicalIds] = await Promise.all([
    listSkillDirectoryIds(vaultRoot),
    listSkillDirectoryIds(canonicalRoot)
  ])
  return [...new Set([...vaultIds, ...canonicalIds])].sort()
}
