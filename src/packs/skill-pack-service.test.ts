import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SkillPackFileSchema, SkillPackSchema } from '../contracts/skill-pack-contract'
import { SkillPackService, readSkillPacks } from './skill-pack-service'
import { previewSkillPack } from './skill-pack-preview'

const roots: string[] = []
const now = '2026-11-01T00:00:00.000Z'
const pack = { id: 'team', name: 'Team', members: ['b', 'c', 'd'], createdAt: now, updatedAt: now }
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('static skill packs', () => {
  it('validates unique members and pack IDs and round trips', () => {
    expect(SkillPackSchema.safeParse({ ...pack, members: [] }).success).toBe(false)
    expect(SkillPackSchema.safeParse({ ...pack, members: ['a', 'a'] }).success).toBe(false)
    expect(SkillPackFileSchema.safeParse({ schemaVersion: 1, packs: [pack, pack] }).success).toBe(
      false
    )
    expect(
      SkillPackFileSchema.parse(JSON.parse(JSON.stringify({ schemaVersion: 1, packs: [pack] })))
    ).toEqual({ schemaVersion: 1, packs: [pack] })
  })
  it('computes append and switch previews and missing members', () => {
    expect(
      previewSkillPack({
        current: new Set(['a', 'b']),
        members: new Set(['b', 'c', 'd', 'x']),
        installed: new Set(['a', 'b', 'c', 'd']),
        mode: 'apply'
      })
    ).toEqual({
      enable: new Set(['c', 'd']),
      disable: new Set(),
      keep: new Set(['a', 'b']),
      missing: new Set(['x'])
    })
    expect(
      previewSkillPack({
        current: new Set(['a', 'b', 'e']),
        members: new Set(['b', 'c', 'd']),
        installed: new Set(['a', 'b', 'c', 'd', 'e']),
        mode: 'switch'
      })
    ).toEqual({
      enable: new Set(['c', 'd']),
      disable: new Set(['a', 'e']),
      keep: new Set(['b']),
      missing: new Set()
    })
  })
  it('applies the preview, switches overlapping packs and deletes without touching links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-pack-'))
    roots.push(root)
    const path = join(root, 'packs.json')
    await writeFile(path, '{')
    expect(await readSkillPacks(path)).toMatchObject({ packs: [], error: expect.any(String) })
    await rm(path)
    const links = join(root, 'links')
    await mkdir(links)
    await symlink(root, join(links, 'link'))
    const before = await readdir(links)
    const effective = new Set(['a', 'b'])
    const service = new SkillPackService(path, {
      getCurrent: async () => new Set(effective),
      getInstalled: async () => new Set(['a', 'b', 'c', 'd']),
      onApplyDiff: async (plan) => {
        for (const id of plan.disable) {
          effective.delete(id)
        }
        for (const id of plan.enable) {
          effective.add(id)
        }
      }
    })
    await service.save(pack)
    await service.save({ ...pack, id: 'other', members: ['b', 'a'] })
    const dry = await service.apply('team', 'apply', true)
    const applied = await service.apply('team', 'apply')
    expect(applied.preview).toEqual(dry.preview)
    expect(effective).toEqual(new Set([...dry.preview.keep, ...dry.preview.enable]))
    await service.apply('team', 'switch')
    expect(effective).toEqual(new Set(['b', 'c', 'd']))
    await service.apply('other', 'switch')
    expect(effective).toEqual(new Set(['a', 'b']))
    await service.delete('team')
    expect(await readdir(links)).toEqual(before)
  })
})
