"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_JOURNAL_ACTIONS = void 0;
exports.enablementJournalPath = enablementJournalPath;
exports.recoverEnablementJournal = recoverEnablementJournal;
exports.journalActionsForPlan = journalActionsForPlan;
exports.serializeJournalV2Chunks = serializeJournalV2Chunks;
exports.applyPlanTransactionally = applyPlanTransactionally;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const readonly_root_fence_1 = require("../infra/readonly-root-fence");
const skill_filesystem_retry_1 = require("../infra/skill-filesystem-retry");
const skill_state_store_1 = require("../infra/skill-state-store");
const skill_alias_1 = require("../infra/skill-alias");
const ENABLEMENT_JOURNAL_MAX_BYTES = 4 * 1024 * 1024;
exports.MAX_JOURNAL_ACTIONS = 2_000;
function enablementJournalPath(stateDirectory, chunkIndex = 0) {
    return chunkIndex === 0
        ? (0, node_path_1.join)(stateDirectory, 'enablement-journal.json')
        : (0, node_path_1.join)(stateDirectory, `enablement-journal.chunk-${chunkIndex}.json`);
}
async function pathExists(path) {
    return Boolean(await (0, promises_1.lstat)(path).catch(() => null));
}
function isEnablementJournalV1(value) {
    const candidate = value;
    return (candidate?.schemaVersion === 1 &&
        candidate.operation === 'enablement' &&
        Array.isArray(candidate.actions));
}
function isEnablementJournalV2(value) {
    const candidate = value;
    return (candidate?.schemaVersion === 2 &&
        candidate.operation === 'enablement' &&
        typeof candidate.vaultRoot === 'string' &&
        typeof candidate.canonicalRoot === 'string' &&
        typeof candidate.providerRoots === 'object' &&
        candidate.providerRoots !== null &&
        Array.isArray(candidate.tuples));
}
async function readJournalEnvelope(filePath, readFileBounded) {
    try {
        const { buffer } = await readFileBounded(filePath, ENABLEMENT_JOURNAL_MAX_BYTES);
        const value = JSON.parse(buffer.toString('utf8'));
        if (isEnablementJournalV2(value)) {
            return value;
        }
        if (isEnablementJournalV1(value)) {
            return value;
        }
        return null;
    }
    catch {
        return null;
    }
}
function opCodeToKind(op) {
    switch (op) {
        case 'L':
            return 'link';
        case 'U':
            return 'unlink';
        case 'C':
            return 'copy';
        case 'R':
            return 'remove-copy';
        case 'M':
            return 'adopt-canonical-to-vault';
    }
}
function kindToOpCode(kind) {
    switch (kind) {
        case 'link':
            return 'L';
        case 'unlink':
            return 'U';
        case 'copy':
            return 'C';
        case 'remove-copy':
            return 'R';
        case 'adopt-canonical-to-vault':
            return 'M';
    }
}
function expandJournalV2(journal) {
    return journal.tuples.flatMap(([op, skillId, providerKey]) => {
        const rootPath = journal.providerRoots[providerKey];
        if (!rootPath) {
            return [];
        }
        const kind = opCodeToKind(op);
        const vaultMaster = (0, node_path_1.join)(journal.vaultRoot, skillId);
        if (kind === 'adopt-canonical-to-vault') {
            return [
                {
                    kind,
                    skillId,
                    provider: providerKey,
                    sourcePath: (0, node_path_1.join)(journal.canonicalRoot, skillId),
                    destinationPath: vaultMaster
                }
            ];
        }
        return [
            {
                kind,
                skillId,
                provider: providerKey,
                sourcePath: vaultMaster,
                destinationPath: (0, node_path_1.join)(rootPath, skillId)
            }
        ];
    });
}
async function adoptCanonicalEntryToVault(canonicalPath, vaultPath) {
    if ((await pathExists(vaultPath)) || !(await pathExists(canonicalPath))) {
        return false;
    }
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(vaultPath), { recursive: true });
    const entryStat = await (0, promises_1.lstat)(canonicalPath);
    if (entryStat.isSymbolicLink()) {
        // Preserve external library link inside Vault without touching the library itself.
        const rawTarget = await (0, promises_1.readlink)(canonicalPath);
        const resolvedTarget = await (0, promises_1.realpath)(canonicalPath).catch(() => (0, node_path_1.resolve)((0, node_path_1.dirname)(canonicalPath), rawTarget));
        if (process.platform === 'win32') {
            await (0, promises_1.symlink)(resolvedTarget, vaultPath, 'junction');
        }
        else {
            const realVaultParent = await (0, promises_1.realpath)((0, node_path_1.dirname)(vaultPath)).catch(() => (0, node_path_1.resolve)((0, node_path_1.dirname)(vaultPath)));
            await (0, promises_1.symlink)((0, node_path_1.relative)(realVaultParent, resolvedTarget), vaultPath, 'dir');
        }
        await (0, promises_1.rm)(canonicalPath, { recursive: true, force: true });
        return true;
    }
    await (0, skill_filesystem_retry_1.renameSkillPathWithWindowsRetry)(canonicalPath, vaultPath);
    return true;
}
/** Every action is independently idempotent, so replaying the whole journal converges. */
async function executeEnablementAction(action, readonlyRoots) {
    await (0, readonly_root_fence_1.assertWritableSkillTarget)(action.destinationPath, { readonlyRoots });
    switch (action.kind) {
        case 'adopt-canonical-to-vault':
            return adoptCanonicalEntryToVault(action.sourcePath, action.destinationPath);
        case 'link':
            if (await pathExists(action.destinationPath)) {
                return false;
            }
            await (0, skill_alias_1.createNativeSkillAlias)(action.sourcePath, action.destinationPath);
            return true;
        case 'unlink':
            if (!(await pathExists(action.destinationPath))) {
                return false;
            }
            await (0, promises_1.rm)(action.destinationPath, { recursive: true, force: true });
            return true;
        case 'copy':
            await (0, promises_1.rm)(action.destinationPath, { recursive: true, force: true }).catch(() => undefined);
            await (0, promises_1.mkdir)((0, node_path_1.dirname)(action.destinationPath), { recursive: true });
            await (0, promises_1.cp)(action.sourcePath, action.destinationPath, { recursive: true, verbatimSymlinks: true });
            return true;
        case 'remove-copy':
            if (!(await pathExists(action.destinationPath))) {
                return false;
            }
            await (0, promises_1.rm)(action.destinationPath, { recursive: true, force: true });
            return true;
    }
}
async function executeLegacyV1Action(action, readonlyRoots) {
    await (0, readonly_root_fence_1.assertWritableSkillTarget)(action.destinationPath, { readonlyRoots });
    switch (action.kind) {
        case 'link':
            if (await pathExists(action.destinationPath)) {
                return false;
            }
            await (0, skill_alias_1.createNativeSkillAlias)(action.sourcePath, action.destinationPath);
            return true;
        case 'unlink':
            if (!(await pathExists(action.destinationPath))) {
                return false;
            }
            await (0, promises_1.rm)(action.destinationPath, { recursive: true, force: true });
            return true;
        case 'move-to-canonical':
        case 'move-to-vault':
            if ((await pathExists(action.destinationPath)) || !(await pathExists(action.sourcePath))) {
                return false;
            }
            await (0, promises_1.mkdir)((0, node_path_1.dirname)(action.destinationPath), { recursive: true });
            await (0, skill_filesystem_retry_1.renameSkillPathWithWindowsRetry)(action.sourcePath, action.destinationPath);
            return true;
    }
}
/** Replay any journal (v1 or multi-chunk v2) left by an interrupted batch until convergence. */
async function recoverEnablementJournal(stateDirectory, readFileBounded, readonlyRoots) {
    const executed = [];
    const primaryPath = enablementJournalPath(stateDirectory, 0);
    const first = await readJournalEnvelope(primaryPath, readFileBounded);
    if (!first) {
        return { executed };
    }
    if (first.schemaVersion === 1) {
        for (const action of first.actions) {
            if (await executeLegacyV1Action(action, readonlyRoots)) {
                executed.push({
                    skillId: action.skillId,
                    provider: action.provider,
                    action: action.kind
                });
            }
        }
        await (0, promises_1.rm)(primaryPath, { force: true });
        return { executed };
    }
    const totalChunks = Math.max(1, first.totalChunks || 1);
    const chunkPaths = [primaryPath];
    const journals = [first];
    for (let i = 1; i < totalChunks; i += 1) {
        const chunkPath = enablementJournalPath(stateDirectory, i);
        const next = await readJournalEnvelope(chunkPath, readFileBounded);
        if (next && next.schemaVersion === 2) {
            chunkPaths.push(chunkPath);
            journals.push(next);
        }
    }
    for (const chunk of journals) {
        for (const action of expandJournalV2(chunk)) {
            if (await executeEnablementAction(action, readonlyRoots)) {
                executed.push({
                    skillId: action.skillId,
                    provider: action.provider,
                    action: action.kind
                });
            }
        }
    }
    for (const chunkPath of chunkPaths) {
        await (0, promises_1.rm)(chunkPath, { force: true }).catch(() => undefined);
    }
    return { executed };
}
function actionOrderRank(kind) {
    if (kind === 'adopt-canonical-to-vault') {
        return 0;
    }
    if (kind === 'unlink' || kind === 'remove-copy') {
        return 1;
    }
    return 2;
}
function journalActionsForPlan(plan, vaultRoot, canonicalRoot) {
    const actions = [];
    for (const action of plan.actions) {
        const observation = action.observation;
        const destinationPath = (0, node_path_1.join)(observation.rootPath, observation.skillId);
        const vaultMaster = (0, node_path_1.join)(vaultRoot, observation.skillId);
        if (action.kind === 'adopt-canonical-to-vault') {
            actions.push({
                kind: 'adopt-canonical-to-vault',
                skillId: observation.skillId,
                provider: observation.provider,
                sourcePath: (0, node_path_1.join)(canonicalRoot, observation.skillId),
                destinationPath: vaultMaster
            });
            continue;
        }
        if (action.kind === 'add') {
            actions.push({
                kind: action.copyMode ? 'copy' : 'link',
                skillId: observation.skillId,
                provider: observation.provider,
                sourcePath: vaultMaster,
                destinationPath
            });
            continue;
        }
        if (action.kind === 'refresh-copy') {
            actions.push({
                kind: 'copy',
                skillId: observation.skillId,
                provider: observation.provider,
                sourcePath: vaultMaster,
                destinationPath
            });
            continue;
        }
        if (action.kind === 'remove') {
            actions.push({
                kind: action.copyMode ? 'remove-copy' : 'unlink',
                skillId: observation.skillId,
                provider: observation.provider,
                sourcePath: vaultMaster,
                destinationPath
            });
        }
    }
    return actions;
}
function serializeJournalV2Chunks(input) {
    const maxPerChunk = Math.max(1, input.maxActionsPerChunk ?? exports.MAX_JOURNAL_ACTIONS);
    const providerRoots = {};
    for (const action of input.plan.actions) {
        providerRoots[action.observation.provider] = action.observation.rootPath;
    }
    const allTuples = input.actions.map((action) => [
        kindToOpCode(action.kind),
        action.skillId,
        action.provider
    ]);
    if (allTuples.length === 0) {
        return [
            {
                schemaVersion: 2,
                operation: 'enablement',
                vaultRoot: input.vaultRoot,
                canonicalRoot: input.canonicalRoot,
                chunkIndex: 0,
                totalChunks: 1,
                providerRoots,
                tuples: []
            }
        ];
    }
    const totalChunks = Math.ceil(allTuples.length / maxPerChunk);
    const chunks = [];
    for (let i = 0; i < totalChunks; i += 1) {
        chunks.push({
            schemaVersion: 2,
            operation: 'enablement',
            vaultRoot: input.vaultRoot,
            canonicalRoot: input.canonicalRoot,
            chunkIndex: i,
            totalChunks,
            providerRoots,
            tuples: allTuples.slice(i * maxPerChunk, (i + 1) * maxPerChunk)
        });
    }
    return chunks;
}
/**
 * Journal-first placement batch using compact chunked EnablementJournalV2:
 * writes every chunk before executing any action, runs Vault migrations before links,
 * and deletes the journal once settled.
 */
async function applyPlanTransactionally(input) {
    const actions = journalActionsForPlan(input.plan, input.vaultRoot, input.canonicalRoot);
    actions.sort((left, right) => actionOrderRank(left.kind) - actionOrderRank(right.kind));
    const chunks = serializeJournalV2Chunks({
        actions,
        plan: input.plan,
        vaultRoot: input.vaultRoot,
        canonicalRoot: input.canonicalRoot,
        maxActionsPerChunk: input.maxActionsPerChunk
    });
    const chunkPaths = chunks.map((_, index) => enablementJournalPath(input.stateDirectory, index));
    for (let i = 0; i < chunks.length; i += 1) {
        await (0, skill_state_store_1.writeSkillStateFile)(chunkPaths[i], chunks[i]);
    }
    const executed = [];
    for (const action of actions) {
        if (input.interruptAfterCount !== undefined && executed.length >= input.interruptAfterCount) {
            throw new Error('skill-enablement-interrupted');
        }
        if (await executeEnablementAction(action, input.readonlyRoots)) {
            executed.push({
                skillId: action.skillId,
                provider: action.provider,
                action: action.kind
            });
        }
    }
    for (const chunkPath of chunkPaths) {
        await (0, promises_1.rm)(chunkPath, { force: true }).catch(() => undefined);
    }
    return executed;
}
