import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  emptySkillVaultIndex,
  salvageSkillVaultIndex,
  SKILL_VAULT_SCHEMA_VERSION,
  type SkillVaultIndex
} from '../contracts/skill-vault-contract'
import { renameSkillPathWithWindowsRetry } from '../infra/skill-filesystem-retry'
import { observeSkillPackage } from '../infra/skill-package-identity'

// ② vault index IO + digest + copy-mode probe (PRD §8 1.7). The digest reuses
// observeSkillPackage so adopt, share manifests, and dedup all agree by construction.

export async function readSkillVaultIndex(indexPath: string): Promise<SkillVaultIndex | null> {
  const raw = await readFile(indexPath, 'utf8').catch(() => null)
  // A corrupt index is derived state: degrade to null and let the caller rebuild.
  return raw === null ? null : salvageSkillVaultIndex(raw)
}

export async function writeSkillVaultIndex(
  indexPath: string,
  index: SkillVaultIndex
): Promise<void> {
  await mkdir(dirname(indexPath), { recursive: true, mode: 0o700 })
  const temporary = `${indexPath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(index)}\n`, 'utf8')
  try {
    await renameSkillPathWithWindowsRetry(temporary, indexPath)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

export async function rebuildSkillVaultIndex(
  indexPath: string,
  entries: SkillVaultIndex['entries']
): Promise<SkillVaultIndex> {
  const index: SkillVaultIndex = {
    schemaVersion: SKILL_VAULT_SCHEMA_VERSION,
    entries: [...entries].sort((left, right) => left.id.localeCompare(right.id))
  }
  await writeSkillVaultIndex(indexPath, index)
  return index
}

/** Whole-tree LF-normalized sha256, identical to the share-manifest package digest. */
export async function computeSkillVaultDigest(skillDirectory: string): Promise<string> {
  const observed = await observeSkillPackage(skillDirectory)
  return observed.observedDigest
}

export async function skillVaultSizeBytes(skillDirectory: string): Promise<number> {
  const observed = await observeSkillPackage(skillDirectory)
  return observed.files.reduce((total, file) => total + file.size, 0)
}

/**
 * Probe once per process whether this host accepts a directory symlink/junction
 * inside the vault root. On failure (Windows without privilege, exFAT, WSL
 * cross-filesystem) the vault degrades to copy mode (PRD §2.3).
 */
export async function detectSkillVaultCopyMode(vaultRoot: string): Promise<boolean> {
  const probeName = `.pmstudio-link-probe-${randomUUID()}`
  const probeTarget = join(vaultRoot, `.pmstudio-probe-target-${randomUUID()}`)
  const probeLink = join(vaultRoot, probeName)
  await mkdir(vaultRoot, { recursive: true })
  try {
    await mkdir(probeTarget)
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    await symlink(probeTarget, probeLink, linkType)
    return false
  } catch {
    return true
  } finally {
    await rm(probeLink, { recursive: true, force: true }).catch(() => undefined)
    await rm(probeTarget, { recursive: true, force: true }).catch(() => undefined)
  }
}

export { emptySkillVaultIndex }
