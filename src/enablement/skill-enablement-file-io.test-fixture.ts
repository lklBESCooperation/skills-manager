import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { SkillEnablementSalvage } from '../contracts/skill-enablement'
import type { SkillEnablementFileIO } from './skill-enablement-applier'

// Standalone-package stand-in for the host's src/shared implementations: the salvage
// semantics match upstream zod-salvage at the level the package's tests assert
// (per-key drops recorded as key names); deep diagnostics stay upstream-tested.
let droppedKeys: string[] | null = null

const fixtureSalvage: SkillEnablementSalvage = {
  collectDrops: (parse) => {
    const previous = droppedKeys
    droppedKeys = []
    try {
      return { value: parse(), droppedPaths: droppedKeys }
    } finally {
      droppedKeys = previous
    }
  },
  salvagingRecord: (<V extends z.ZodType>(_key: z.ZodType<string>, value: V) =>
    z.unknown().transform((raw, ctx) => {
      const clean: Record<string, z.output<V>> = {}
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        ctx.addIssue({ code: 'custom', message: 'expected record' })
        return clean
      }
      for (const [entryKey, entryValue] of Object.entries(raw)) {
        if (entryKey === '__proto__') {
          continue
        }
        const parsed = value.safeParse(entryValue)
        if (parsed.success) {
          clean[entryKey] = parsed.data
        } else {
          droppedKeys?.push(entryKey)
        }
      }
      return clean
    })) as SkillEnablementSalvage['salvagingRecord']
}

/** Bounded-read limit enforcement lives host-side; the fixture reads plainly. */
export function fixtureSkillEnablementFileIO(): SkillEnablementFileIO {
  return {
    salvage: fixtureSalvage,
    readFileBounded: async (filePath) => ({ buffer: await readFile(filePath) })
  }
}

export { fixtureSalvage }
