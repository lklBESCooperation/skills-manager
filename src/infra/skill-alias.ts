// Ported createNativeSkillAlias from src/main/skills/skill-placement-reconciliation.ts
// (upstream-shared); preserves Vault master symlinks without dereferencing the master itself.
import { mkdir, realpath, symlink } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'

export async function createNativeSkillAlias(
  canonicalPath: string,
  destinationPath: string
): Promise<void> {
  const parent = dirname(destinationPath)
  await mkdir(parent, { recursive: true })
  if (process.platform === 'win32') {
    await symlink(resolve(canonicalPath), destinationPath, 'junction')
    return
  }
  const realParent = await realpath(parent).catch(() => resolve(parent))
  const realCanonicalParent = await realpath(dirname(canonicalPath)).catch(() =>
    resolve(dirname(canonicalPath))
  )
  const targetPath = join(realCanonicalParent, basename(canonicalPath))
  await symlink(relative(realParent, targetPath), destinationPath, 'dir')
}
