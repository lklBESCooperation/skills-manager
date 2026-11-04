import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  isDynamicSkillPack,
  SkillPackFileSchema,
  SkillPackSchema,
  type SkillPack,
  type SkillPackReadResult,
  type SkillPackScope
} from '../contracts/skill-pack-contract'
import { previewSkillPack, type SkillPackMode, type SkillPackPreview } from './skill-pack-preview'

export function skillPackFilePath(scope: SkillPackScope, home: string, project?: string): string {
  if (scope === 'user') {
    return join(home, '.pmstudio', 'packs.json')
  }
  if (!project) {
    throw new Error('skill-pack-project-required')
  }
  return join(project, '.pmstudio', 'packs.json')
}

export async function readSkillPacks(path: string): Promise<SkillPackReadResult> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    const parsed = SkillPackFileSchema.safeParse(value)
    return parsed.success
      ? { packs: parsed.data.packs, error: null }
      : { packs: [], error: 'skill-pack-file-invalid' }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { packs: [], error: null }
    }
    return { packs: [], error: error instanceof Error ? error.message : String(error) }
  }
}

async function writeSkillPacks(path: string, packs: SkillPack[]): Promise<void> {
  const value = SkillPackFileSchema.parse({ schemaVersion: 1, packs })
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export class SkillPackService<T = unknown> {
  constructor(
    private readonly path: string,
    private readonly dependencies: {
      getCurrent: () => Promise<ReadonlySet<string>>
      getInstalled: () => Promise<ReadonlySet<string>>
      onApplyDiff: (plan: SkillPackPreview) => Promise<T>
    }
  ) {}

  async list(): Promise<
    SkillPackReadResult & { entries: { pack: SkillPack; missing: string[] }[] }
  > {
    const result = await readSkillPacks(this.path)
    const installed = await this.dependencies.getInstalled()
    return {
      ...result,
      entries: result.packs.map((pack) => ({
        pack,
        missing: (isDynamicSkillPack(pack) ? [] : pack.members).filter((id) => !installed.has(id))
      }))
    }
  }

  async save(pack: SkillPack, dryRun = false): Promise<SkillPack> {
    const valid = SkillPackSchema.parse(pack)
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
  ): Promise<SkillPack> {
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

  async apply(
    id: string,
    mode: SkillPackMode,
    dryRun = false
  ): Promise<{ preview: SkillPackPreview; result?: T }> {
    const file = await readSkillPacks(this.path)
    if (file.error) {
      throw new Error(file.error)
    }
    const pack = file.packs.find((entry) => entry.id === id)
    if (!pack) {
      throw new Error('skill-pack-not-found')
    }
    if (isDynamicSkillPack(pack)) {
      throw new Error('skill-pack-dynamic-requires-evaluation')
    }
    const [current, installed] = await Promise.all([
      this.dependencies.getCurrent(),
      this.dependencies.getInstalled()
    ])
    const preview = previewSkillPack({ current, installed, members: new Set(pack.members), mode })
    return dryRun ? { preview } : { preview, result: await this.dependencies.onApplyDiff(preview) }
  }
}
