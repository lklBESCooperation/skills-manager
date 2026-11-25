import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  isDynamicRuleV2,
  isDynamicSkillPack,
  SkillPackExportBundleSchema,
  SkillPackFileSchema,
  SkillPackFileV2Schema,
  SkillPackUndoRingSchema,
  SkillPackV2Schema,
  type SkillPackExportBundle,
  type SkillPackPreviewDiff,
  type SkillPackReadResult,
  type SkillPackScope,
  type SkillPackUndoSnapshot,
  type SkillPackV2
} from '../contracts/skill-pack-contract'
import { READONLY_SKILL_ERROR_CODE } from '../contracts/plugin-skill-contract'
import {
  previewDynamicSkillPack,
  type DynamicPackHitEntry,
  type SkillPackDiffFn
} from './skill-pack-dynamic'
import { previewSkillPack, type SkillPackMode, type SkillPackPreview } from './skill-pack-preview'
import type { SkillVaultEntryLike } from './skill-pack-rule-eval'

const MAX_UNDO_SNAPSHOTS = 10

export function skillPackFilePath(scope: SkillPackScope, home: string, project?: string): string {
  if (scope === 'user') {
    return join(home, '.pmstudio', 'packs.json')
  }
  if (!project) {
    throw new Error('skill-pack-project-required')
  }
  return join(project, '.pmstudio', 'packs.json')
}

export function skillPackUndoRingPath(packsFilePath: string): string {
  return join(dirname(packsFilePath), 'history', 'undo-ring.json')
}

export async function readSkillPacks(path: string): Promise<SkillPackReadResult> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    const v2 = SkillPackFileV2Schema.safeParse(value)
    if (v2.success) {
      return { packs: v2.data.packs, error: null }
    }
    const v1 = SkillPackFileSchema.safeParse(value)
    return v1.success
      ? { packs: v1.data.packs, error: null }
      : { packs: [], error: 'skill-pack-file-invalid' }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { packs: [], error: null }
    }
    return { packs: [], error: error instanceof Error ? error.message : String(error) }
  }
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function writeSkillPacks(path: string, packs: SkillPackV2[]): Promise<void> {
  const needsV2 = packs.some((pack) => isDynamicSkillPack(pack) && isDynamicRuleV2(pack.dynamic))
  const value = needsV2
    ? SkillPackFileV2Schema.parse({ schemaVersion: 2, packs })
    : SkillPackFileSchema.parse({ schemaVersion: 1, packs })
  await writeAtomicJson(path, value)
}

function toPreviewDiff(preview: SkillPackPreview): SkillPackPreviewDiff {
  return {
    enable: [...preview.enable],
    disable: [...preview.disable],
    keep: [...preview.keep],
    missing: [...preview.missing]
  }
}

export class SkillPackService<T = unknown> {
  constructor(
    private readonly path: string,
    private readonly dependencies: {
      getCurrent: () => Promise<ReadonlySet<string>>
      getInstalled: () => Promise<ReadonlySet<string>>
      onApplyDiff: (plan: SkillPackPreview) => Promise<T>
      getEntries?: () => Promise<readonly SkillVaultEntryLike[]>
      isReadonlySkillId?: (id: string) => Promise<boolean> | boolean
      undoRingPath?: string
      scope?: SkillPackScope
    }
  ) {}

  private get undoPath(): string {
    return this.dependencies.undoRingPath ?? skillPackUndoRingPath(this.path)
  }

  async list(): Promise<
    SkillPackReadResult & { entries: { pack: SkillPackV2; missing: string[] }[] }
  > {
    const result = await readSkillPacks(this.path)
    const installed = await this.dependencies.getInstalled()
    const vaultEntries = this.dependencies.getEntries
      ? await this.dependencies.getEntries()
      : null
    return {
      ...result,
      entries: result.packs.map((pack) => {
        if (isDynamicSkillPack(pack)) {
          if (!vaultEntries) {
            return { pack, missing: [] }
          }
          const preview = previewDynamicSkillPack({
            pack: pack as never,
            entries: vaultEntries,
            currentEnabledIds: [],
            mode: 'apply',
            computeDiff: () => ({ enable: [], disable: [], keep: [], missing: [] })
          })
          return {
            pack,
            missing: preview.hitIds.filter((id) => !installed.has(id))
          }
        }
        return {
          pack,
          missing: pack.members.filter((id) => !installed.has(id))
        }
      })
    }
  }

  async save(pack: SkillPackV2, dryRun = false): Promise<SkillPackV2> {
    const valid = SkillPackV2Schema.parse(pack)
    if (!isDynamicSkillPack(valid) && this.dependencies.isReadonlySkillId) {
      for (const memberId of valid.members) {
        if (await this.dependencies.isReadonlySkillId(memberId)) {
          throw new Error(`${READONLY_SKILL_ERROR_CODE}: ${memberId}`)
        }
      }
    }
    const current = await readSkillPacks(this.path)
    if (current.error) {
      throw new Error(current.error)
    }
    const packs = [...current.packs.filter((entry) => entry.id !== valid.id), valid]
    if (!dryRun) {
      await writeSkillPacks(this.path, packs)
    }
    return valid
  }

  async saveCurrent(
    input: { id: string; name: string; description?: string },
    dryRun = false
  ): Promise<SkillPackV2> {
    const now = new Date().toISOString()
    const current = await readSkillPacks(this.path)
    if (current.error) {
      throw new Error(current.error)
    }
    const existing = current.packs.find((pack) => pack.id === input.id)
    return this.save(
      {
        ...input,
        members: [...(await this.dependencies.getCurrent())],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      },
      dryRun
    )
  }

  async delete(id: string, dryRun = false): Promise<boolean> {
    const current = await readSkillPacks(this.path)
    if (current.error) {
      throw new Error(current.error)
    }
    const packs = current.packs.filter((pack) => pack.id !== id)
    if (packs.length === current.packs.length) {
      return false
    }
    if (!dryRun) {
      await writeSkillPacks(this.path, packs)
    }
    return true
  }

  /** Unified preview for both static and dynamic packs (D-8 merge). */
  async preview(
    id: string,
    mode: SkillPackMode
  ): Promise<{
    preview: SkillPackPreview
    diff: SkillPackPreviewDiff
    hitIds?: string[]
    hitEntries?: DynamicPackHitEntry[]
  }> {
    const file = await readSkillPacks(this.path)
    if (file.error) {
      throw new Error(file.error)
    }
    const pack = file.packs.find((entry) => entry.id === id)
    if (!pack) {
      throw new Error('skill-pack-not-found')
    }
    const [current, installed] = await Promise.all([
      this.dependencies.getCurrent(),
      this.dependencies.getInstalled()
    ])
    const computeDiff: SkillPackDiffFn = (currentIds, memberIds, opMode) =>
      toPreviewDiff(
        previewSkillPack({
          current: new Set(currentIds),
          members: new Set(memberIds),
          installed,
          mode: opMode
        })
      )

    if (!isDynamicSkillPack(pack)) {
      const preview = previewSkillPack({
        current,
        installed,
        members: new Set(pack.members),
        mode
      })
      return { preview, diff: toPreviewDiff(preview) }
    }

    const entries = await this.resolveEntries(installed)
    const dynamicPreview = previewDynamicSkillPack({
      pack: pack as never,
      entries,
      currentEnabledIds: [...current],
      mode,
      computeDiff
    })
    const preview = previewSkillPack({
      current,
      installed,
      members: new Set(dynamicPreview.hitIds),
      mode
    })
    return {
      preview,
      diff: dynamicPreview.diff,
      hitIds: dynamicPreview.hitIds,
      hitEntries: dynamicPreview.hitEntries
    }
  }

  /** Unified apply for both static and dynamic packs, recording a pre-apply Undo snapshot. */
  async apply(
    id: string,
    mode: SkillPackMode,
    dryRun = false
  ): Promise<{
    preview: SkillPackPreview
    hitIds?: string[]
    hitEntries?: DynamicPackHitEntry[]
    undoId?: string
    result?: T
  }> {
    const computed = await this.preview(id, mode)
    if (dryRun) {
      return {
        preview: computed.preview,
        ...(computed.hitIds ? { hitIds: computed.hitIds } : {}),
        ...(computed.hitEntries ? { hitEntries: computed.hitEntries } : {})
      }
    }
    const current = await this.dependencies.getCurrent()
    const undoId = await this.recordUndoSnapshot({
      packId: id,
      mode,
      previousEnabledIds: [...current],
      affectedSkillIds: [...computed.preview.enable, ...computed.preview.disable]
    })
    const result = await this.dependencies.onApplyDiff(computed.preview)
    return {
      preview: computed.preview,
      ...(computed.hitIds ? { hitIds: computed.hitIds } : {}),
      ...(computed.hitEntries ? { hitEntries: computed.hitEntries } : {}),
      undoId,
      result
    }
  }

  async listUndoSnapshots(): Promise<SkillPackUndoSnapshot[]> {
    try {
      const parsed = SkillPackUndoRingSchema.safeParse(
        JSON.parse(await readFile(this.undoPath, 'utf8'))
      )
      return parsed.success ? parsed.data.snapshots : []
    } catch {
      return []
    }
  }

  async rollback(undoId?: string): Promise<{ snapshot: SkillPackUndoSnapshot; result: T }> {
    const snapshots = await this.listUndoSnapshots()
    const snapshot = undoId
      ? snapshots.find((item) => item.undoId === undoId)
      : snapshots.at(-1)
    if (!snapshot) {
      throw new Error('skill-pack-undo-not-found')
    }
    const [current, installed] = await Promise.all([
      this.dependencies.getCurrent(),
      this.dependencies.getInstalled()
    ])
    const preview = previewSkillPack({
      current,
      installed,
      members: new Set(snapshot.previousEnabledIds),
      mode: 'switch'
    })
    const result = await this.dependencies.onApplyDiff(preview)
    const remaining = snapshots.filter((item) => item.undoId !== snapshot.undoId)
    await writeAtomicJson(this.undoPath, { schemaVersion: 1, snapshots: remaining })
    return { snapshot, result }
  }

  async exportPack(
    id: string,
    cloudRefs?: SkillPackExportBundle['cloudRefs']
  ): Promise<SkillPackExportBundle> {
    const file = await readSkillPacks(this.path)
    if (file.error) {
      throw new Error(file.error)
    }
    const pack = file.packs.find((entry) => entry.id === id)
    if (!pack) {
      throw new Error('skill-pack-not-found')
    }
    return SkillPackExportBundleSchema.parse({
      format: 'pmstudio-pack-v1',
      exportedAt: new Date().toISOString(),
      pack,
      ...(cloudRefs ? { cloudRefs } : {})
    })
  }

  async importPack(
    rawBundle: unknown,
    options?: { conflictStrategy?: 'overwrite' | 'rename' | 'reject' }
  ): Promise<{ pack: SkillPackV2; missing: string[] }> {
    const bundle = SkillPackExportBundleSchema.parse(rawBundle)
    const current = await readSkillPacks(this.path)
    if (current.error) {
      throw new Error(current.error)
    }
    let targetPack = bundle.pack
    const existing = current.packs.find((item) => item.id === targetPack.id)
    if (existing) {
      const strategy = options?.conflictStrategy ?? 'reject'
      if (strategy === 'reject') {
        throw new Error(`skill-pack-conflict: ${targetPack.id}`)
      }
      if (strategy === 'rename') {
        targetPack = {
          ...targetPack,
          id: `${targetPack.id}-${randomUUID().slice(0, 6)}`,
          name: `${targetPack.name} (Imported)`
        }
      }
    }
    const saved = await this.save(targetPack)
    const installed = await this.dependencies.getInstalled()
    const missing = isDynamicSkillPack(saved)
      ? []
      : saved.members.filter((member) => !installed.has(member))
    return { pack: saved, missing }
  }

  private async resolveEntries(
    installed: ReadonlySet<string>
  ): Promise<readonly SkillVaultEntryLike[]> {
    if (this.dependencies.getEntries) {
      return this.dependencies.getEntries()
    }
    return [...installed].map((id) => ({
      id,
      name: id,
      sourceKind: 'adopted',
      tags: [],
      author: null
    }))
  }

  private async recordUndoSnapshot(input: {
    packId: string
    mode: SkillPackMode
    previousEnabledIds: string[]
    affectedSkillIds: string[]
  }): Promise<string> {
    const existing = await this.listUndoSnapshots()
    const undoId = randomUUID()
    const snapshot: SkillPackUndoSnapshot = {
      undoId,
      packId: input.packId,
      mode: input.mode,
      scope: this.dependencies.scope ?? 'user',
      createdAt: new Date().toISOString(),
      affectedSkillIds: input.affectedSkillIds,
      previousEnabledIds: input.previousEnabledIds
    }
    const nextSnapshots = [...existing, snapshot].slice(-MAX_UNDO_SNAPSHOTS)
    await writeAtomicJson(this.undoPath, { schemaVersion: 1, snapshots: nextSnapshots })
    return undoId
  }
}
