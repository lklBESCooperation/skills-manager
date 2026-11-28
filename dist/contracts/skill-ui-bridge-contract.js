"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditFixInputSchema = exports.PackImportInputSchema = exports.PackRollbackInputSchema = exports.PackModeInputSchema = exports.PackIdInputSchema = exports.PackSaveInputSchema = exports.PackSaveCurrentInputSchema = exports.PackScopeInputSchema = exports.SkillAdoptInputSchema = exports.SkillMutateInputSchema = exports.SkillAgentMatrixInputSchema = exports.SKILL_BRIDGE_EVENTS = exports.SKILL_BRIDGE_METHODS = void 0;
const zod_1 = require("zod");
const skill_pack_contract_1 = require("./skill-pack-contract");
const tui_agent_1 = require("./tui-agent");
exports.SKILL_BRIDGE_METHODS = {
    workbenchSnapshot: 'skills.workbench.snapshot',
    panelSnapshot: 'skills.panel.snapshot',
    skillAgentMatrix: 'skills.skill.agentMatrix',
    enablementMutate: 'skills.enablement.mutate',
    pluginsRescan: 'skills.plugins.rescan',
    vaultAdopt: 'skills.vault.adopt',
    packsList: 'skills.packs.list',
    packsSaveCurrent: 'skills.packs.saveCurrent',
    packsSave: 'skills.packs.save',
    packsDelete: 'skills.packs.delete',
    packsPreview: 'skills.packs.preview',
    packsApply: 'skills.packs.apply',
    packsRollback: 'skills.packs.rollback',
    packsExport: 'skills.packs.export',
    packsImport: 'skills.packs.import',
    auditRun: 'skills.audit.run',
    auditFix: 'skills.audit.fix'
};
exports.SKILL_BRIDGE_EVENTS = {
    skillsChanged: 'skills.changed',
    contextChanged: 'skills.contextChanged'
};
exports.SkillAgentMatrixInputSchema = zod_1.z
    .object({
    skillId: zod_1.z.string().min(1).max(128),
    scope: zod_1.z.enum(['user', 'workspace'])
})
    .strict();
const AgentIdSchema = zod_1.z.enum(tui_agent_1.TUI_AGENTS);
exports.SkillMutateInputSchema = zod_1.z
    .object({
    kind: zod_1.z.enum(['enable', 'disable', 'inherit']),
    skillIds: zod_1.z.array(zod_1.z.string().min(1).max(128)).min(1),
    writeScope: zod_1.z.enum(['user', 'project']),
    skillScope: zod_1.z.enum(['user', 'workspace']).optional(),
    agents: zod_1.z.partialRecord(AgentIdSchema, zod_1.z.boolean()).optional()
})
    .strict();
exports.SkillAdoptInputSchema = zod_1.z
    .object({
    scope: zod_1.z.enum(['user', 'workspace']),
    skillIds: zod_1.z.array(zod_1.z.string().min(1).max(128)).min(1)
})
    .strict();
exports.PackScopeInputSchema = zod_1.z
    .object({
    scope: zod_1.z.enum(['user', 'project'])
})
    .strict();
exports.PackSaveCurrentInputSchema = zod_1.z
    .object({
    scope: zod_1.z.enum(['user', 'project']),
    id: zod_1.z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: zod_1.z.string().trim().min(1).max(128),
    description: zod_1.z.string().max(512).optional()
})
    .strict();
exports.PackSaveInputSchema = zod_1.z
    .object({
    scope: zod_1.z.enum(['user', 'project']),
    pack: skill_pack_contract_1.SkillPackV2Schema
})
    .strict();
exports.PackIdInputSchema = zod_1.z
    .object({
    scope: zod_1.z.enum(['user', 'project']),
    id: zod_1.z.string().min(1).max(128)
})
    .strict();
exports.PackModeInputSchema = zod_1.z
    .object({
    scope: zod_1.z.enum(['user', 'project']),
    id: zod_1.z.string().min(1).max(128),
    mode: skill_pack_contract_1.SkillPackOperationModeSchema
})
    .strict();
exports.PackRollbackInputSchema = zod_1.z
    .object({
    scope: zod_1.z.enum(['user', 'project']),
    undoId: zod_1.z.string().min(1).optional()
})
    .strict();
exports.PackImportInputSchema = zod_1.z
    .object({
    scope: zod_1.z.enum(['user', 'project']),
    bundle: skill_pack_contract_1.SkillPackExportBundleSchema,
    conflictStrategy: zod_1.z.enum(['overwrite', 'rename', 'reject']).optional()
})
    .strict();
exports.AuditFixInputSchema = zod_1.z
    .object({
    scope: zod_1.z.enum(['user', 'project']).optional(),
    kinds: zod_1.z.array(zod_1.z.enum(['orphan-symlink', 'readonly-plugin-exposure'])).optional(),
    paths: zod_1.z.array(zod_1.z.string().min(1)).optional()
})
    .strict();
