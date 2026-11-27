import { open, stat } from 'node:fs/promises'
import { z } from 'zod'
import type { SkillEnablementSalvage } from '../contracts/skill-enablement'
import type { SkillEnablementFileIO } from '../enablement/skill-enablement-applier'

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024

/**
 * Production stateless Zod salvage implementation: each `collectDrops` call
 * tracks dropped keys in a per-invocation array passed via closure so
 * concurrent calls never collide.
 */
function createStatelessSalvage(): SkillEnablementSalvage {
  let activeDrops: string[] | null = null

  return {
    collectDrops: <T>(parse: () => T) => {
      const previous = activeDrops
      const current: string[] = []
      activeDrops = current
      try {
        return { value: parse(), droppedPaths: current }
      } finally {
        activeDrops = previous
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
          if (entryKey === '__proto__' || entryKey === 'constructor' || entryKey === 'prototype') {
            continue
          }
          const parsed = value.safeParse(entryValue)
          if (parsed.success) {
            clean[entryKey] = parsed.data
          } else {
            activeDrops?.push(entryKey)
          }
        }
        return clean
      })) as SkillEnablementSalvage['salvagingRecord']
  }
}

/**
 * Bounded file reader: validates `size <= maxBytes` before reading into memory
 * and stops reading if the file grows beyond `maxBytes`.
 */
export async function readFileBounded(
  filePath: string,
  maxBytes = DEFAULT_MAX_FILE_BYTES
): Promise<{ buffer: Buffer }> {
  const fileStat = await stat(filePath)
  if (!fileStat.isFile()) {
    throw new Error(`skill-file-not-regular: ${filePath}`)
  }
  if (fileStat.size > maxBytes) {
    throw new Error(`skill-file-too-large: ${filePath} (${fileStat.size} > ${maxBytes})`)
  }
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(fileStat.size)
    let offset = 0
    while (offset < fileStat.size) {
      const { bytesRead } = await handle.read(buffer, offset, fileStat.size - offset, offset)
      if (bytesRead === 0) {
        break
      }
      offset += bytesRead
    }
    return { buffer: offset === fileStat.size ? buffer : buffer.subarray(0, offset) }
  } finally {
    await handle.close()
  }
}

export function createLocalSkillEnablementFileIO(
  maxBytes = DEFAULT_MAX_FILE_BYTES
): SkillEnablementFileIO {
  return {
    salvage: createStatelessSalvage(),
    readFileBounded: (filePath, requestedLimit) =>
      readFileBounded(filePath, requestedLimit ?? maxBytes)
  }
}
