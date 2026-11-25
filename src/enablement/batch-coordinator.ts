import { classifySkillInstallFailureCode, type SkillInstallFailure } from '../contracts/skill-install-failure'
import { ReadonlySkillProtectedError } from '../infra/readonly-root-fence'

export type BatchSkillFailure = {
  skillId: string
  error: string
  failure: SkillInstallFailure
}

export type BatchOperationReport<TSucceeded = string> = {
  succeeded: TSucceeded[]
  skippedBusy: string[]
  skippedReadonly: string[]
  conflicts: string[]
  failed: BatchSkillFailure[]
}

export type SkillLockPort = {
  acquireScopeLock(scopeKey: string, timeoutMs: number): Promise<() => Promise<void>>
  tryAcquireSkillLock(skillKey: string, timeoutMs: number): Promise<(() => Promise<void>) | null>
}

export class InMemoryHierarchicalLockManager implements SkillLockPort {
  private readonly scopeQueues = new Map<string, Promise<void>>()
  private readonly heldScopes = new Set<string>()
  private readonly heldSkills = new Set<string>()

  async acquireScopeLock(scopeKey: string, timeoutMs: number): Promise<() => Promise<void>> {
    const deadline = Date.now() + timeoutMs
    while (this.heldScopes.has(scopeKey)) {
      if (Date.now() >= deadline) {
        throw new Error(`skill-batch-scope-lock-timeout: ${scopeKey}`)
      }
      const pending = this.scopeQueues.get(scopeKey)
      if (pending) {
        await Promise.race([pending, new Promise<void>((r) => setTimeout(r, 15))])
      } else {
        await new Promise<void>((r) => setTimeout(r, 10))
      }
    }
    this.heldScopes.add(scopeKey)
    let resolveQueue!: () => void
    const queuePromise = new Promise<void>((resolve) => {
      resolveQueue = resolve
    })
    this.scopeQueues.set(scopeKey, queuePromise)
    return async () => {
      this.heldScopes.delete(scopeKey)
      this.scopeQueues.delete(scopeKey)
      resolveQueue()
    }
  }

  async tryAcquireSkillLock(
    skillKey: string,
    timeoutMs: number
  ): Promise<(() => Promise<void>) | null> {
    const deadline = Date.now() + timeoutMs
    while (this.heldSkills.has(skillKey)) {
      if (Date.now() >= deadline) {
        return null
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
    this.heldSkills.add(skillKey)
    return async () => {
      this.heldSkills.delete(skillKey)
    }
  }
}

function classifyError(error: unknown): SkillInstallFailure {
  if (error instanceof ReadonlySkillProtectedError) {
    return error.failure
  }
  const message = error instanceof Error ? error.message : String(error)
  const code = message.split(':')[0]?.trim() ?? ''
  return (
    classifySkillInstallFailureCode(code) ?? {
      category: 'filesystem',
      code: 'skill-install-batch-failed',
      retryable: true
    }
  )
}

/**
 * Two-level deadlock-free batch coordinator (Architect §3.3):
 * Level-1 scope mutex lock + Level-2 lexicographically ordered per-skill locks.
 * Isolates per-skill failures so one error never aborts unrelated skills.
 */
export class BatchCoordinator {
  constructor(private readonly locks: SkillLockPort = new InMemoryHierarchicalLockManager()) {}

  async executePerSkill<TItem, TSucceeded>(input: {
    scopeKey: string
    items: readonly TItem[]
    getSkillId: (item: TItem) => string
    isConflict?: (item: TItem) => boolean
    isReadonly?: (item: TItem) => Promise<boolean> | boolean
    runItem: (item: TItem) => Promise<TSucceeded>
    scopeTimeoutMs?: number
    skillTimeoutMs?: number
  }): Promise<BatchOperationReport<TSucceeded>> {
    const releaseScope = await this.locks.acquireScopeLock(
      input.scopeKey,
      input.scopeTimeoutMs ?? 10_000
    )

    const sortedItems = [...input.items].sort((left, right) =>
      input.getSkillId(left).localeCompare(input.getSkillId(right))
    )

    const report: BatchOperationReport<TSucceeded> = {
      succeeded: [],
      skippedBusy: [],
      skippedReadonly: [],
      conflicts: [],
      failed: []
    }

    const acquiredSkillReleases: (() => Promise<void>)[] = []
    try {
      const unlockedItems: TItem[] = []
      for (const item of sortedItems) {
        const skillId = input.getSkillId(item)
        if (input.isConflict?.(item)) {
          report.conflicts.push(skillId)
          continue
        }
        if (input.isReadonly && (await input.isReadonly(item))) {
          report.skippedReadonly.push(skillId)
          continue
        }
        const releaseSkill = await this.locks.tryAcquireSkillLock(
          `${input.scopeKey}:${skillId}`,
          input.skillTimeoutMs ?? 500
        )
        if (!releaseSkill) {
          report.skippedBusy.push(skillId)
          continue
        }
        acquiredSkillReleases.push(releaseSkill)
        unlockedItems.push(item)
      }

      for (const item of unlockedItems) {
        const skillId = input.getSkillId(item)
        try {
          const result = await input.runItem(item)
          report.succeeded.push(result)
        } catch (error) {
          if (error instanceof ReadonlySkillProtectedError) {
            report.skippedReadonly.push(skillId)
            continue
          }
          report.failed.push({
            skillId,
            error: error instanceof Error ? error.message : String(error),
            failure: classifyError(error)
          })
        }
      }
      return report
    } finally {
      for (const release of acquiredSkillReleases.toReversed()) {
        await release().catch(() => undefined)
      }
      await releaseScope().catch(() => undefined)
    }
  }
}
