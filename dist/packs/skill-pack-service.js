"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillPackService = void 0;
exports.skillPackFilePath = skillPackFilePath;
exports.readSkillPacks = readSkillPacks;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const skill_pack_contract_1 = require("../contracts/skill-pack-contract");
const skill_pack_preview_1 = require("./skill-pack-preview");
function skillPackFilePath(scope, home, project) {
    if (scope === 'user') {
        return (0, node_path_1.join)(home, '.pmstudio', 'packs.json');
    }
    if (!project) {
        throw new Error('skill-pack-project-required');
    }
    return (0, node_path_1.join)(project, '.pmstudio', 'packs.json');
}
async function readSkillPacks(path) {
    try {
        const value = JSON.parse(await (0, promises_1.readFile)(path, 'utf8'));
        const parsed = skill_pack_contract_1.SkillPackFileSchema.safeParse(value);
        return parsed.success
            ? { packs: parsed.data.packs, error: null }
            : { packs: [], error: 'skill-pack-file-invalid' };
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return { packs: [], error: null };
        }
        return { packs: [], error: error instanceof Error ? error.message : String(error) };
    }
}
async function writeSkillPacks(path, packs) {
    const value = skill_pack_contract_1.SkillPackFileSchema.parse({ schemaVersion: 1, packs });
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(path), { recursive: true });
    const temporary = `${path}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    try {
        await (0, promises_1.writeFile)(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        await (0, promises_1.rename)(temporary, path);
    }
    finally {
        await (0, promises_1.rm)(temporary, { force: true });
    }
}
class SkillPackService {
    path;
    dependencies;
    constructor(path, dependencies) {
        this.path = path;
        this.dependencies = dependencies;
    }
    async list() {
        const result = await readSkillPacks(this.path);
        const installed = await this.dependencies.getInstalled();
        return {
            ...result,
            entries: result.packs.map((pack) => ({
                pack,
                missing: ((0, skill_pack_contract_1.isDynamicSkillPack)(pack) ? [] : pack.members).filter((id) => !installed.has(id))
            }))
        };
    }
    async save(pack, dryRun = false) {
        const valid = skill_pack_contract_1.SkillPackSchema.parse(pack);
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
    async apply(id, mode, dryRun = false) {
        const file = await readSkillPacks(this.path);
        if (file.error) {
            throw new Error(file.error);
        }
        const pack = file.packs.find((entry) => entry.id === id);
        if (!pack) {
            throw new Error('skill-pack-not-found');
        }
        if ((0, skill_pack_contract_1.isDynamicSkillPack)(pack)) {
            throw new Error('skill-pack-dynamic-requires-evaluation');
        }
        const [current, installed] = await Promise.all([
            this.dependencies.getCurrent(),
            this.dependencies.getInstalled()
        ]);
        const preview = (0, skill_pack_preview_1.previewSkillPack)({ current, installed, members: new Set(pack.members), mode });
        return dryRun ? { preview } : { preview, result: await this.dependencies.onApplyDiff(preview) };
    }
}
exports.SkillPackService = SkillPackService;
