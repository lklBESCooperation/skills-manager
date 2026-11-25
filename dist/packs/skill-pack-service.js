"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillPackService = void 0;
exports.skillPackFilePath = skillPackFilePath;
exports.skillPackUndoRingPath = skillPackUndoRingPath;
exports.readSkillPacks = readSkillPacks;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const skill_pack_contract_1 = require("../contracts/skill-pack-contract");
const plugin_skill_contract_1 = require("../contracts/plugin-skill-contract");
const skill_pack_dynamic_1 = require("./skill-pack-dynamic");
const skill_pack_preview_1 = require("./skill-pack-preview");
const MAX_UNDO_SNAPSHOTS = 10;
function skillPackFilePath(scope, home, project) {
    if (scope === 'user') {
        return (0, node_path_1.join)(home, '.pmstudio', 'packs.json');
    }
    if (!project) {
        throw new Error('skill-pack-project-required');
    }
    return (0, node_path_1.join)(project, '.pmstudio', 'packs.json');
}
function skillPackUndoRingPath(packsFilePath) {
    return (0, node_path_1.join)((0, node_path_1.dirname)(packsFilePath), 'history', 'undo-ring.json');
}
async function readSkillPacks(path) {
    try {
        const value = JSON.parse(await (0, promises_1.readFile)(path, 'utf8'));
        const v2 = skill_pack_contract_1.SkillPackFileV2Schema.safeParse(value);
        if (v2.success) {
            return { packs: v2.data.packs, error: null };
        }
        const v1 = skill_pack_contract_1.SkillPackFileSchema.safeParse(value);
        return v1.success
            ? { packs: v1.data.packs, error: null }
            : { packs: [], error: 'skill-pack-file-invalid' };
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return { packs: [], error: null };
        }
        return { packs: [], error: error instanceof Error ? error.message : String(error) };
    }
}
async function writeAtomicJson(path, value) {
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(path), { recursive: true });
    const temporary = `${path}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    try {
        await (0, promises_1.writeFile)(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        await (0, promises_1.rename)(temporary, path);
    }
    finally {
        await (0, promises_1.rm)(temporary, { force: true }).catch(() => undefined);
    }
}
async function writeSkillPacks(path, packs) {
    const needsV2 = packs.some((pack) => (0, skill_pack_contract_1.isDynamicSkillPack)(pack) && (0, skill_pack_contract_1.isDynamicRuleV2)(pack.dynamic));
    const value = needsV2
        ? skill_pack_contract_1.SkillPackFileV2Schema.parse({ schemaVersion: 2, packs })
        : skill_pack_contract_1.SkillPackFileSchema.parse({ schemaVersion: 1, packs });
    await writeAtomicJson(path, value);
}
function toPreviewDiff(preview) {
    return {
        enable: [...preview.enable],
        disable: [...preview.disable],
        keep: [...preview.keep],
        missing: [...preview.missing]
    };
}
class SkillPackService {
    path;
    dependencies;
    constructor(path, dependencies) {
        this.path = path;
        this.dependencies = dependencies;
    }
    get undoPath() {
        return this.dependencies.undoRingPath ?? skillPackUndoRingPath(this.path);
    }
    async list() {
        const result = await readSkillPacks(this.path);
        const installed = await this.dependencies.getInstalled();
        const vaultEntries = this.dependencies.getEntries
            ? await this.dependencies.getEntries()
            : null;
        return {
            ...result,
            entries: result.packs.map((pack) => {
                if ((0, skill_pack_contract_1.isDynamicSkillPack)(pack)) {
                    if (!vaultEntries) {
                        return { pack, missing: [] };
                    }
                    const preview = (0, skill_pack_dynamic_1.previewDynamicSkillPack)({
                        pack: pack,
                        entries: vaultEntries,
                        currentEnabledIds: [],
                        mode: 'apply',
                        computeDiff: () => ({ enable: [], disable: [], keep: [], missing: [] })
                    });
                    return {
                        pack,
                        missing: preview.hitIds.filter((id) => !installed.has(id))
                    };
                }
                return {
                    pack,
                    missing: pack.members.filter((id) => !installed.has(id))
                };
            })
        };
    }
    async save(pack, dryRun = false) {
        const valid = skill_pack_contract_1.SkillPackV2Schema.parse(pack);
        if (!(0, skill_pack_contract_1.isDynamicSkillPack)(valid) && this.dependencies.isReadonlySkillId) {
            for (const memberId of valid.members) {
                if (await this.dependencies.isReadonlySkillId(memberId)) {
                    throw new Error(`${plugin_skill_contract_1.READONLY_SKILL_ERROR_CODE}: ${memberId}`);
                }
            }
        }
        const current = await readSkillPacks(this.path);
        if (current.error) {
            throw new Error(current.error);
        }
        const packs = [...current.packs.filter((entry) => entry.id !== valid.id), valid];
        if (!dryRun) {
            await writeSkillPacks(this.path, packs);
        }
        return valid;
    }
    async saveCurrent(input, dryRun = false) {
        const now = new Date().toISOString();
        const current = await readSkillPacks(this.path);
        if (current.error) {
            throw new Error(current.error);
        }
        const existing = current.packs.find((pack) => pack.id === input.id);
        return this.save({
            ...input,
            members: [...(await this.dependencies.getCurrent())],
            createdAt: existing?.createdAt ?? now,
            updatedAt: now
        }, dryRun);
    }
    async delete(id, dryRun = false) {
        const current = await readSkillPacks(this.path);
        if (current.error) {
            throw new Error(current.error);
        }
        const packs = current.packs.filter((pack) => pack.id !== id);
        if (packs.length === current.packs.length) {
            return false;
        }
        if (!dryRun) {
            await writeSkillPacks(this.path, packs);
        }
        return true;
    }
    /** Unified preview for both static and dynamic packs (D-8 merge). */
    async preview(id, mode) {
        const file = await readSkillPacks(this.path);
        if (file.error) {
            throw new Error(file.error);
        }
        const pack = file.packs.find((entry) => entry.id === id);
        if (!pack) {
            throw new Error('skill-pack-not-found');
        }
        const [current, installed] = await Promise.all([
            this.dependencies.getCurrent(),
            this.dependencies.getInstalled()
        ]);
        const computeDiff = (currentIds, memberIds, opMode) => toPreviewDiff((0, skill_pack_preview_1.previewSkillPack)({
            current: new Set(currentIds),
            members: new Set(memberIds),
            installed,
            mode: opMode
        }));
        if (!(0, skill_pack_contract_1.isDynamicSkillPack)(pack)) {
            const preview = (0, skill_pack_preview_1.previewSkillPack)({
                current,
                installed,
                members: new Set(pack.members),
                mode
            });
            return { preview, diff: toPreviewDiff(preview) };
        }
        const entries = await this.resolveEntries(installed);
        const dynamicPreview = (0, skill_pack_dynamic_1.previewDynamicSkillPack)({
            pack: pack,
            entries,
            currentEnabledIds: [...current],
            mode,
            computeDiff
        });
        const preview = (0, skill_pack_preview_1.previewSkillPack)({
            current,
            installed,
            members: new Set(dynamicPreview.hitIds),
            mode
        });
        return {
            preview,
            diff: dynamicPreview.diff,
            hitIds: dynamicPreview.hitIds,
            hitEntries: dynamicPreview.hitEntries
        };
    }
    /** Unified apply for both static and dynamic packs, recording a pre-apply Undo snapshot. */
    async apply(id, mode, dryRun = false) {
        const computed = await this.preview(id, mode);
        if (dryRun) {
            return {
                preview: computed.preview,
                ...(computed.hitIds ? { hitIds: computed.hitIds } : {}),
                ...(computed.hitEntries ? { hitEntries: computed.hitEntries } : {})
            };
        }
        const current = await this.dependencies.getCurrent();
        const undoId = await this.recordUndoSnapshot({
            packId: id,
            mode,
            previousEnabledIds: [...current],
            affectedSkillIds: [...computed.preview.enable, ...computed.preview.disable]
        });
        const result = await this.dependencies.onApplyDiff(computed.preview);
        return {
            preview: computed.preview,
            ...(computed.hitIds ? { hitIds: computed.hitIds } : {}),
            ...(computed.hitEntries ? { hitEntries: computed.hitEntries } : {}),
            undoId,
            result
        };
    }
    async listUndoSnapshots() {
        try {
            const parsed = skill_pack_contract_1.SkillPackUndoRingSchema.safeParse(JSON.parse(await (0, promises_1.readFile)(this.undoPath, 'utf8')));
            return parsed.success ? parsed.data.snapshots : [];
        }
        catch {
            return [];
        }
    }
    async rollback(undoId) {
        const snapshots = await this.listUndoSnapshots();
        const snapshot = undoId
            ? snapshots.find((item) => item.undoId === undoId)
            : snapshots.at(-1);
        if (!snapshot) {
            throw new Error('skill-pack-undo-not-found');
        }
        const [current, installed] = await Promise.all([
            this.dependencies.getCurrent(),
            this.dependencies.getInstalled()
        ]);
        const preview = (0, skill_pack_preview_1.previewSkillPack)({
            current,
            installed,
            members: new Set(snapshot.previousEnabledIds),
            mode: 'switch'
        });
        const result = await this.dependencies.onApplyDiff(preview);
        const remaining = snapshots.filter((item) => item.undoId !== snapshot.undoId);
        await writeAtomicJson(this.undoPath, { schemaVersion: 1, snapshots: remaining });
        return { snapshot, result };
    }
    async exportPack(id, cloudRefs) {
        const file = await readSkillPacks(this.path);
        if (file.error) {
            throw new Error(file.error);
        }
        const pack = file.packs.find((entry) => entry.id === id);
        if (!pack) {
            throw new Error('skill-pack-not-found');
        }
        return skill_pack_contract_1.SkillPackExportBundleSchema.parse({
            format: 'pmstudio-pack-v1',
            exportedAt: new Date().toISOString(),
            pack,
            ...(cloudRefs ? { cloudRefs } : {})
        });
    }
    async importPack(rawBundle, options) {
        const bundle = skill_pack_contract_1.SkillPackExportBundleSchema.parse(rawBundle);
        const current = await readSkillPacks(this.path);
        if (current.error) {
            throw new Error(current.error);
        }
        let targetPack = bundle.pack;
        const existing = current.packs.find((item) => item.id === targetPack.id);
        if (existing) {
            const strategy = options?.conflictStrategy ?? 'reject';
            if (strategy === 'reject') {
                throw new Error(`skill-pack-conflict: ${targetPack.id}`);
            }
            if (strategy === 'rename') {
                targetPack = {
                    ...targetPack,
                    id: `${targetPack.id}-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`,
                    name: `${targetPack.name} (Imported)`
                };
            }
        }
        const saved = await this.save(targetPack);
        const installed = await this.dependencies.getInstalled();
        const missing = (0, skill_pack_contract_1.isDynamicSkillPack)(saved)
            ? []
            : saved.members.filter((member) => !installed.has(member));
        return { pack: saved, missing };
    }
    async resolveEntries(installed) {
        if (this.dependencies.getEntries) {
            return this.dependencies.getEntries();
        }
        return [...installed].map((id) => ({
            id,
            name: id,
            sourceKind: 'adopted',
            tags: [],
            author: null
        }));
    }
    async recordUndoSnapshot(input) {
        const existing = await this.listUndoSnapshots();
        const undoId = (0, node_crypto_1.randomUUID)();
        const snapshot = {
            undoId,
            packId: input.packId,
            mode: input.mode,
            scope: this.dependencies.scope ?? 'user',
            createdAt: new Date().toISOString(),
            affectedSkillIds: input.affectedSkillIds,
            previousEnabledIds: input.previousEnabledIds
        };
        const nextSnapshots = [...existing, snapshot].slice(-MAX_UNDO_SNAPSHOTS);
        await writeAtomicJson(this.undoPath, { schemaVersion: 1, snapshots: nextSnapshots });
        return undoId;
    }
}
exports.SkillPackService = SkillPackService;
