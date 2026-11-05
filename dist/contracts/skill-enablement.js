"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SKILL_PROJECT_STATE_FILENAME = exports.SKILL_USER_DEFAULTS_FILENAME = exports.SKILL_ENABLEMENT_STATE_DIRNAME = exports.SkillEffectiveStateSchema = exports.SkillOverrideSchema = exports.SKILL_EFFECTIVE_VALUES = exports.SKILL_OVERRIDE_VALUES = exports.SKILL_ENABLEMENT_SCHEMA_VERSION = void 0;
exports.parseSkillUserDefaultsFile = parseSkillUserDefaultsFile;
exports.parseSkillProjectStateFile = parseSkillProjectStateFile;
exports.skillUserDefaultsFileValue = skillUserDefaultsFileValue;
exports.skillProjectStateFileValue = skillProjectStateFileValue;
exports.resolveEffectiveSkills = resolveEffectiveSkills;
const zod_1 = require("zod");
exports.SKILL_ENABLEMENT_SCHEMA_VERSION = 1;
exports.SKILL_OVERRIDE_VALUES = ['inherit', 'enabled', 'disabled'];
exports.SKILL_EFFECTIVE_VALUES = ['enabled', 'disabled'];
exports.SkillOverrideSchema = zod_1.z.enum(exports.SKILL_OVERRIDE_VALUES);
exports.SkillEffectiveStateSchema = zod_1.z.enum(exports.SKILL_EFFECTIVE_VALUES);
exports.SKILL_ENABLEMENT_STATE_DIRNAME = '.pmstudio';
exports.SKILL_USER_DEFAULTS_FILENAME = 'skills-user-defaults.json';
exports.SKILL_PROJECT_STATE_FILENAME = 'skills-state.json';
function userDefaultsFileSchema(salvage) {
    return zod_1.z.object({
        schemaVersion: zod_1.z.literal(exports.SKILL_ENABLEMENT_SCHEMA_VERSION),
        defaults: salvage.salvagingRecord(zod_1.z.string(), exports.SkillEffectiveStateSchema)
    });
}
function projectStateFileSchema(salvage) {
    return zod_1.z.object({
        schemaVersion: zod_1.z.literal(exports.SKILL_ENABLEMENT_SCHEMA_VERSION),
        overrides: salvage.salvagingRecord(zod_1.z.string(), exports.SkillOverrideSchema)
    });
}
function parsedFileEnvelope(raw) {
    if (raw === null) {
        return undefined;
    }
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
function parseSkillUserDefaultsFile(raw, salvage) {
    const { value, droppedPaths } = salvage.collectDrops(() => userDefaultsFileSchema(salvage).safeParse(parsedFileEnvelope(raw)));
    if (value.success) {
        return {
            value: value.data.defaults,
            droppedKeys: droppedPaths,
            unreadable: false
        };
    }
    return { value: {}, droppedKeys: droppedPaths, unreadable: raw !== null };
}
function parseSkillProjectStateFile(raw, salvage) {
    const { value, droppedPaths } = salvage.collectDrops(() => projectStateFileSchema(salvage).safeParse(parsedFileEnvelope(raw)));
    if (value.success) {
        return {
            value: value.data.overrides,
            droppedKeys: droppedPaths,
            unreadable: false
        };
    }
    return { value: {}, droppedKeys: droppedPaths, unreadable: raw !== null };
}
function sortedRecord(record) {
    const sorted = {};
    for (const key of Object.keys(record).sort()) {
        if (key === '__proto__') {
            continue;
        }
        sorted[key] = record[key];
    }
    return sorted;
}
/** Deterministic key order keeps the git-committed project state file diff-stable. */
function skillUserDefaultsFileValue(defaults) {
    return {
        schemaVersion: exports.SKILL_ENABLEMENT_SCHEMA_VERSION,
        defaults: sortedRecord(defaults)
    };
}
function skillProjectStateFileValue(overrides) {
    return {
        schemaVersion: exports.SKILL_ENABLEMENT_SCHEMA_VERSION,
        overrides: sortedRecord(overrides)
    };
}
/**
 * Final effective state per installed skill: project override wins, `inherit` and absence fall
 * back to the user default, and an absent user default keeps the install-is-enabled default.
 * Keys naming skills outside `installed` are ignored by construction.
 */
function resolveEffectiveSkills(input) {
    const resolved = new Map();
    for (const id of input.installed) {
        const override = input.projectOverrides[id];
        if (override === 'enabled' || override === 'disabled') {
            resolved.set(id, { effective: override, origin: 'project' });
            continue;
        }
        resolved.set(id, {
            effective: input.userDefaults[id] ?? 'enabled',
            origin: 'user'
        });
    }
    return resolved;
}
