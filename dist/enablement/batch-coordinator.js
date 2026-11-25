"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchCoordinator = exports.InMemoryHierarchicalLockManager = void 0;
const skill_install_failure_1 = require("../contracts/skill-install-failure");
const readonly_root_fence_1 = require("../infra/readonly-root-fence");
class InMemoryHierarchicalLockManager {
    scopeQueues = new Map();
    heldScopes = new Set();
    heldSkills = new Set();
    async acquireScopeLock(scopeKey, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        while (this.heldScopes.has(scopeKey)) {
            if (Date.now() >= deadline) {
                throw new Error(`skill-batch-scope-lock-timeout: ${scopeKey}`);
            }
            const pending = this.scopeQueues.get(scopeKey);
            if (pending) {
                await Promise.race([pending, new Promise((r) => setTimeout(r, 15))]);
            }
            else {
                await new Promise((r) => setTimeout(r, 10));
            }
        }
        this.heldScopes.add(scopeKey);
        let resolveQueue;
        const queuePromise = new Promise((resolve) => {
            resolveQueue = resolve;
        });
        this.scopeQueues.set(scopeKey, queuePromise);
        return async () => {
            this.heldScopes.delete(scopeKey);
            this.scopeQueues.delete(scopeKey);
            resolveQueue();
        };
    }
    async tryAcquireSkillLock(skillKey, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        while (this.heldSkills.has(skillKey)) {
            if (Date.now() >= deadline) {
                return null;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        this.heldSkills.add(skillKey);
        return async () => {
            this.heldSkills.delete(skillKey);
        };
    }
}
exports.InMemoryHierarchicalLockManager = InMemoryHierarchicalLockManager;
function classifyError(error) {
    if (error instanceof readonly_root_fence_1.ReadonlySkillProtectedError) {
        return error.failure;
    }
    const message = error instanceof Error ? error.message : String(error);
    const code = message.split(':')[0]?.trim() ?? '';
    return ((0, skill_install_failure_1.classifySkillInstallFailureCode)(code) ?? {
        category: 'filesystem',
        code: 'skill-install-batch-failed',
        retryable: true
    });
}
/**
 * Two-level deadlock-free batch coordinator (Architect §3.3):
 * Level-1 scope mutex lock + Level-2 lexicographically ordered per-skill locks.
 * Isolates per-skill failures so one error never aborts unrelated skills.
 */
class BatchCoordinator {
    locks;
    constructor(locks = new InMemoryHierarchicalLockManager()) {
        this.locks = locks;
    }
    async executePerSkill(input) {
        const releaseScope = await this.locks.acquireScopeLock(input.scopeKey, input.scopeTimeoutMs ?? 10_000);
        const sortedItems = [...input.items].sort((left, right) => input.getSkillId(left).localeCompare(input.getSkillId(right)));
        const report = {
            succeeded: [],
            skippedBusy: [],
            skippedReadonly: [],
            conflicts: [],
            failed: []
        };
        const acquiredSkillReleases = [];
        try {
            const unlockedItems = [];
            for (const item of sortedItems) {
                const skillId = input.getSkillId(item);
                if (input.isConflict?.(item)) {
                    report.conflicts.push(skillId);
                    continue;
                }
                if (input.isReadonly && (await input.isReadonly(item))) {
                    report.skippedReadonly.push(skillId);
                    continue;
                }
                const releaseSkill = await this.locks.tryAcquireSkillLock(`${input.scopeKey}:${skillId}`, input.skillTimeoutMs ?? 500);
                if (!releaseSkill) {
                    report.skippedBusy.push(skillId);
                    continue;
                }
                acquiredSkillReleases.push(releaseSkill);
                unlockedItems.push(item);
            }
            for (const item of unlockedItems) {
                const skillId = input.getSkillId(item);
                try {
                    const result = await input.runItem(item);
                    report.succeeded.push(result);
                }
                catch (error) {
                    if (error instanceof readonly_root_fence_1.ReadonlySkillProtectedError) {
                        report.skippedReadonly.push(skillId);
                        continue;
                    }
                    report.failed.push({
                        skillId,
                        error: error instanceof Error ? error.message : String(error),
                        failure: classifyError(error)
                    });
                }
            }
            return report;
        }
        finally {
            for (const release of acquiredSkillReleases.toReversed()) {
                await release().catch(() => undefined);
            }
            await releaseScope().catch(() => undefined);
        }
    }
}
exports.BatchCoordinator = BatchCoordinator;
