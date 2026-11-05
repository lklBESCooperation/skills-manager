"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.previewDynamicSkillPack = previewDynamicSkillPack;
exports.applyDynamicSkillPack = applyDynamicSkillPack;
exports.previewSkillPack = previewSkillPack;
const skill_pack_contract_1 = require("../contracts/skill-pack-contract");
const skill_pack_rule_eval_1 = require("./skill-pack-rule-eval");
/**
 * ⑤ dynamic pack preview: evaluate the rule at read time, feed the hit set into
 * the same preview used by static packs, and return the hit list alongside so
 * the UI can show "命中 N 个: …" before confirmation.
 */
function previewDynamicSkillPack(input) {
    const hits = (0, skill_pack_rule_eval_1.evaluateDynamicPack)(input.pack.dynamic, input.entries);
    const hitIds = hits.map((entry) => entry.id);
    return {
        hitIds,
        hitEntries: hits.map((entry) => ({ id: entry.id, name: entry.name })),
        diff: input.computeDiff(input.currentEnabledIds, hitIds, input.mode)
    };
}
/**
 * ⑤ dynamic pack apply: evaluate, then ride the exact same static apply path
 * (`applyMembers`) with the evaluated member list. Returned `appliedMemberIds`
 * equals `hitIds` of the preview over the same index — assert this where the
 * service wires both steps (T4.6).
 */
function applyDynamicSkillPack(input) {
    const preview = previewDynamicSkillPack(input);
    const applied = input.applyMembers(preview.hitIds);
    return { ...preview, appliedMemberIds: preview.hitIds, applied };
}
/** Dispatch used by the service for mixed pack lists: dynamic → evaluate first. */
function previewSkillPack(input) {
    if (!(0, skill_pack_contract_1.isDynamicSkillPack)(input.pack)) {
        return input.computeDiff(input.currentEnabledIds, input.pack.members, input.mode);
    }
    const preview = previewDynamicSkillPack({ ...input, pack: input.pack });
    return { ...preview.diff, hitIds: preview.hitIds, hitEntries: preview.hitEntries };
}
/*
 * TODO(P3 merge — step 4.3, one line each once skill-pack-service.ts lands):
 * 1. preview entry point:
 *      previewSkillPack({ pack, entries: vaultIndex.entries, currentEnabledIds, mode, computeDiff })
 *    where computeDiff delegates to the real skill-pack-preview export
 *    (adapt the mode argument to its actual signature if it differs).
 * 2. apply/switch confirm path: call applyDynamicSkillPack with the service's
 *    existing static applyMembers (the function that lands enable/disable links)
 *    so dynamic packs change no apply semantics.
 */
