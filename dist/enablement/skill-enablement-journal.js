"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enablementJournalPath = enablementJournalPath;
exports.recoverEnablementJournal = recoverEnablementJournal;
exports.journalActionsForPlan = journalActionsForPlan;
exports.applyPlanTransactionally = applyPlanTransactionally;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const skill_state_store_1 = require("../infra/skill-state-store");
const skill_filesystem_retry_1 = require("../infra/skill-filesystem-retry");
const skill_alias_1 = require("../infra/skill-alias");
const ENABLEMENT_JOURNAL_MAX_BYTES = 4 * 1024 * 1024;
function enablementJournalPath(stateDirectory) {
    return (0, node_path_1.join)(stateDirectory, 'enablement-journal.json');
}
async function pathExists(path) {
    return Boolean(await (0, promises_1.lstat)(path).catch(() => null));
}
// Narrow unknown JSON to the journal shape; the single cast sits under a SAFETY directive.
function isEnablementJournalV1(value) {
    // SAFETY: field checks below cover every journal member before the shape is trusted.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: unknown JSON narrowed by the field checks that follow.
    const candidate = value;
    return (candidate?.schemaVersion === 1 &&
        candidate.operation === 'enablement' &&
        Array.isArray(candidate.actions));
}
async function readEnablementJournal(stateDirectory, readFileBounded) {
    try {
        const { buffer } = await readFileBounded(enablementJournalPath(stateDirectory), ENABLEMENT_JOURNAL_MAX_BYTES);
        const value = JSON.parse(buffer.toString('utf8'));
        return isEnablementJournalV1(value) ? value : null;
    }
    catch {
        return null;
    }
}
/** Every action is independently idempotent, so replaying the whole journal converges. */
async function executeEnablementAction(action) {
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
/** Replay a journal left by an interrupted batch until every action lands or no-ops. */
async function recoverEnablementJournal(stateDirectory, readFileBounded) {
    const journal = await readEnablementJournal(stateDirectory, readFileBounded);
    if (!journal) {
        return { executed: [] };
    }
    const executed = [];
    for (const action of journal.actions) {
        if (await executeEnablementAction(action)) {
            executed.push({
                skillId: action.skillId,
                provider: action.provider,
                action: action.kind
            });
        }
    }
    await (0, promises_1.rm)(enablementJournalPath(stateDirectory), { force: true });
    return { executed };
}
/** Moves run before links so link sources reflect the post-move master location. */
function actionOrderRank(kind) {
    if (kind === 'move-to-canonical' || kind === 'move-to-vault') {
        return 0;
    }
    return 1;
}
function journalActionsForPlan(plan, vaultRoot, canonicalRoot) {
    const actions = [];
    // The plan's end state decides link destinations: any canonical provider enabling in this
    // batch moves the master to canonical, so every link for that skill must target canonical.
    const canonicalEndState = new Set(plan.actions
        .filter((action) => action.kind === 'move-to-canonical')
        .map((action) => action.observation.skillId));
    // Where the master lives right now (move source); never the planned end state.
    const masterNowAt = (skillId) => plan.masters[skillId]?.location === 'canonical'
        ? (0, node_path_1.join)(canonicalRoot, skillId)
        : (0, node_path_1.join)(vaultRoot, skillId);
    // Where links must point once this batch settles (move destination).
    const masterEndAt = (skillId) => canonicalEndState.has(skillId) || plan.masters[skillId]?.location === 'canonical'
        ? (0, node_path_1.join)(canonicalRoot, skillId)
        : (0, node_path_1.join)(vaultRoot, skillId);
    for (const action of plan.actions) {
        const observation = action.observation;
        const destinationPath = (0, node_path_1.join)(observation.rootPath, observation.skillId);
        const vaultMaster = (0, node_path_1.join)(vaultRoot, observation.skillId);
        if (observation.readsCanonicalRoot) {
            if (action.kind === 'move-to-canonical') {
                actions.push({
                    kind: 'move-to-canonical',
                    skillId: observation.skillId,
                    provider: observation.provider,
                    sourcePath: masterNowAt(observation.skillId),
                    destinationPath: (0, node_path_1.join)(canonicalRoot, observation.skillId)
                });
            }
            else if (action.kind === 'remove') {
                actions.push({
                    kind: 'move-to-vault',
                    skillId: observation.skillId,
                    provider: observation.provider,
                    sourcePath: destinationPath,
                    destinationPath: vaultMaster
                });
            }
            continue;
        }
        if (action.kind === 'add') {
            actions.push({
                kind: 'link',
                skillId: observation.skillId,
                provider: observation.provider,
                sourcePath: masterEndAt(observation.skillId),
                destinationPath
            });
        }
        else if (action.kind === 'remove') {
            actions.push({
                kind: 'unlink',
                skillId: observation.skillId,
                provider: observation.provider,
                sourcePath: masterEndAt(observation.skillId),
                destinationPath
            });
        }
    }
    return actions;
}
/**
 * Journal-first placement batch: write every action before running any, run moves before
 * links, delete the journal once settled. An interruption leaves the journal so the next
 * run replays to convergence with no half-enabled state.
 */
async function applyPlanTransactionally(input) {
    const actions = journalActionsForPlan(input.plan, input.vaultRoot, input.canonicalRoot);
    actions.sort((left, right) => actionOrderRank(left.kind) - actionOrderRank(right.kind));
    const journal = {
        schemaVersion: 1,
        operation: 'enablement',
        phase: 'prepared',
        executedCount: 0,
        actions
    };
    await (0, skill_state_store_1.writeSkillStateFile)(enablementJournalPath(input.stateDirectory), journal);
    journal.phase = 'executing';
    const executed = [];
    for (const action of actions) {
        if (input.interruptAfterCount !== undefined && executed.length >= input.interruptAfterCount) {
            // Simulated power loss: leave the journal so the next run replays to convergence.
            throw new Error('skill-enablement-interrupted');
        }
        if (await executeEnablementAction(action)) {
            executed.push({
                skillId: action.skillId,
                provider: action.provider,
                action: action.kind
            });
        }
    }
    journal.phase = 'settled';
    journal.executedCount = executed.length;
    await (0, promises_1.rm)(enablementJournalPath(input.stateDirectory), { force: true });
    return executed;
}
