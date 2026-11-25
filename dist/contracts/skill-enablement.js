"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SKILL_PROJECT_STATE_FILENAME = exports.SKILL_USER_DEFAULTS_FILENAME = exports.SKILL_ENABLEMENT_STATE_DIRNAME = exports.SkillEffectiveStateSchema = exports.SkillOverrideSchema = exports.SKILL_EFFECTIVE_VALUES = exports.SKILL_OVERRIDE_VALUES = exports.SKILL_ENABLEMENT_V2_SCHEMA_VERSION = exports.SKILL_ENABLEMENT_SCHEMA_VERSION = void 0;
exports.parseSkillUserDefaultsFile = parseSkillUserDefaultsFile;
exports.parseSkillProjectStateFile = parseSkillProjectStateFile;
exports.skillUserDefaultsFileValue = skillUserDefaultsFileValue;
exports.skillProjectStateFileValue = skillProjectStateFileValue;
exports.resolveEffectiveSkills = resolveEffectiveSkills;
exports.isSkillEffectiveForAgent = isSkillEffectiveForAgent;
const zod_1 = require("zod");
const agent_skill_registry_1 = require("./agent-skill-registry");
const tui_agent_1 = require("./tui-agent");
exports.SKILL_ENABLEMENT_SCHEMA_VERSION = 1;
exports.SKILL_ENABLEMENT_V2_SCHEMA_VERSION = 2;
exports.SKILL_OVERRIDE_VALUES = ['inherit', 'enabled', 'disabled'];
exports.SKILL_EFFECTIVE_VALUES = ['enabled', 'disabled'];
exports.SkillOverrideSchema = zod_1.z.enum(exports.SKILL_OVERRIDE_VALUES);
exports.SkillEffectiveStateSchema = zod_1.z.enum(exports.SKILL_EFFECTIVE_VALUES);
exports.SKILL_ENABLEMENT_STATE_DIRNAME = '.pmstudio';
exports.SKILL_USER_DEFAULTS_FILENAME = 'skills-user-defaults.json';
exports.SKILL_PROJECT_STATE_FILENAME = 'skills-state.json';
function userDefaultsFileSchema(salvage) {
    return zod_1.z.object({
        schemaVersion: zod_1.z.union([
            zod_1.z.literal(exports.SKILL_ENABLEMENT_SCHEMA_VERSION),
            zod_1.z.literal(exports.SKILL_ENABLEMENT_V2_SCHEMA_VERSION)
        ]),
        defaults: salvage.salvagingRecord(zod_1.z.string(), exports.SkillEffectiveStateSchema),
        agentOverrides: zod_1.z.record(zod_1.z.string(), zod_1.z.record(zod_1.z.string(), zod_1.z.boolean())).optional()
    });
}
function projectStateFileSchema(salvage) {
    return zod_1.z.object({
        schemaVersion: zod_1.z.union([
            zod_1.z.literal(exports.SKILL_ENABLEMENT_SCHEMA_VERSION),
            zod_1.z.literal(exports.SKILL_ENABLEMENT_V2_SCHEMA_VERSION)
        ]),
        overrides: salvage.salvagingRecord(zod_1.z.string(), exports.SkillOverrideSchema),
        agentOverrides: zod_1.z.record(zod_1.z.string(), zod_1.z.record(zod_1.z.string(), zod_1.z.boolean())).optional()
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
function sanitizeAgentOverrides(raw) {
    if (!raw) {
        return undefined;
    }
    const clean = {};
    for (const skillId of Object.keys(raw).sort()) {
        if (skillId === '__proto__') {
            continue;
        }
        const perAgent = raw[skillId];
        if (!perAgent || typeof perAgent !== 'object') {
            continue;
        }
        const filtered = {};
        let hasEntry = false;
        for (const agentKey of Object.keys(perAgent).sort()) {
            if ((0, tui_agent_1.isTuiAgent)(agentKey) && typeof perAgent[agentKey] === 'boolean') {
                filtered[agentKey] = perAgent[agentKey];
                hasEntry = true;
            }
        }
        if (hasEntry) {
            clean[skillId] = filtered;
        }
    }
    return Object.keys(clean).length > 0 ? clean : undefined;
}
function parseSkillUserDefaultsFile(raw, salvage) {
    const { value, droppedPaths } = salvage.collectDrops(() => userDefaultsFileSchema(salvage).safeParse(parsedFileEnvelope(raw)));
    if (value.success) {
        const agentOverrides = sanitizeAgentOverrides(value.data.agentOverrides);
        return {
            value: value.data.defaults,
            ...(agentOverrides ? { agentOverrides } : {}),
            droppedKeys: droppedPaths,
            unreadable: false
        };
    }
    return { value: {}, droppedKeys: droppedPaths, unreadable: raw !== null };
}
function parseSkillProjectStateFile(raw, salvage) {
    const { value, droppedPaths } = salvage.collectDrops(() => projectStateFileSchema(salvage).safeParse(parsedFileEnvelope(raw)));
    if (value.success) {
        const agentOverrides = sanitizeAgentOverrides(value.data.agentOverrides);
        return {
            value: value.data.overrides,
            ...(agentOverrides ? { agentOverrides } : {}),
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
function sortedAgentOverrides(overrides) {
    if (!overrides) {
        return undefined;
    }
    const clean = sanitizeAgentOverrides(overrides);
    return clean;
}
/** Deterministic key order keeps the git-committed project state file diff-stable. */
function skillUserDefaultsFileValue(defaults, agentOverrides) {
    const cleanAgentOverrides = sortedAgentOverrides(agentOverrides);
    return {
        schemaVersion: exports.SKILL_ENABLEMENT_SCHEMA_VERSION,
        defaults: sortedRecord(defaults),
        ...(cleanAgentOverrides ? { agentOverrides: cleanAgentOverrides } : {})
    };
}
function skillProjectStateFileValue(overrides, agentOverrides) {
    const cleanAgentOverrides = sortedAgentOverrides(agentOverrides);
    return {
        schemaVersion: exports.SKILL_ENABLEMENT_SCHEMA_VERSION,
        overrides: sortedRecord(overrides),
        ...(cleanAgentOverrides ? { agentOverrides: cleanAgentOverrides } : {})
    };
}
function resolveAgentStatesForSkill(input) {
    const targetAgents = input.agents ?? tui_agent_1.TUI_AGENTS;
    const details = {};
    const userOverrides = input.userAgentOverrides?.[input.skillId];
    const projectOverrides = input.projectAgentOverrides?.[input.skillId];
    // Pass 1: direct agent resolution (skipping delegates and borrow locks)
    for (const agent of tui_agent_1.TUI_AGENTS) {
        const descriptor = agent_skill_registry_1.AGENT_SKILL_REGISTRY[agent];
        if (descriptor.capability === 'unsupported') {
            details[agent] = { effective: 'disabled', origin: 'unsupported' };
            continue;
        }
        if (descriptor.capability === 'delegate') {
            continue;
        }
        const projectValue = projectOverrides?.[agent];
        if (typeof projectValue === 'boolean') {
            details[agent] = {
                effective: projectValue ? 'enabled' : 'disabled',
                origin: 'agent-override'
            };
            continue;
        }
        const userValue = userOverrides?.[agent];
        if (typeof userValue === 'boolean') {
            details[agent] = {
                effective: userValue ? 'enabled' : 'disabled',
                origin: 'agent-override'
            };
            continue;
        }
        details[agent] = {
            effective: input.baseEffective,
            origin: input.baseOrigin
        };
    }
    // Pass 2: resolve delegates and borrowed-owner visibility locks (Q2)
    for (const agent of tui_agent_1.TUI_AGENTS) {
        const descriptor = agent_skill_registry_1.AGENT_SKILL_REGISTRY[agent];
        if (descriptor.capability === 'delegate' && descriptor.delegatesTo) {
            const targetDetail = details[descriptor.delegatesTo];
            details[agent] = targetDetail
                ? { ...targetDetail }
                : { effective: 'disabled', origin: 'unsupported' };
            continue;
        }
        const current = details[agent];
        if (!current || current.effective === 'enabled' || descriptor.capability === 'unsupported') {
            continue;
        }
        const owners = (0, agent_skill_registry_1.getAgentBorrowedOwners)(agent, input.scope);
        const activeOwner = owners.find((owner) => details[owner]?.effective === 'enabled');
        if (activeOwner) {
            details[agent] = {
                effective: 'enabled',
                origin: 'borrowed-lock',
                borrowedFrom: activeOwner,
                locked: true
            };
        }
    }
    const agents = {};
    const agentDetails = {};
    for (const agent of targetAgents) {
        const detail = details[agent];
        if (detail) {
            agents[agent] = detail.effective === 'enabled';
            agentDetails[agent] = detail;
        }
    }
    return { agents, agentDetails };
}
/**
 * Final effective state per installed skill: project override wins, `inherit` and absence fall
 * back to the user default, and an absent user default keeps the install-is-enabled default.
 * When per-agent overrides or `includeAgents` are provided, populates `agents` and `agentDetails`.
 */
function resolveEffectiveSkills(input) {
    const includeMatrix = Boolean(input.includeAgents) ||
        Boolean(input.userAgentOverrides && Object.keys(input.userAgentOverrides).length > 0) ||
        Boolean(input.projectAgentOverrides && Object.keys(input.projectAgentOverrides).length > 0);
    const scope = input.scope ?? 'global';
    const resolved = new Map();
    for (const id of input.installed) {
        const override = input.projectOverrides[id];
        const baseEffective = override === 'enabled' || override === 'disabled'
            ? override
            : (input.userDefaults[id] ?? 'enabled');
        const baseOrigin = override === 'enabled' || override === 'disabled' ? 'project' : 'user';
        if (!includeMatrix) {
            resolved.set(id, { effective: baseEffective, origin: baseOrigin });
            continue;
        }
        const matrix = resolveAgentStatesForSkill({
            skillId: id,
            baseEffective,
            baseOrigin,
            scope,
            userAgentOverrides: input.userAgentOverrides,
            projectAgentOverrides: input.projectAgentOverrides,
            agents: input.agents
        });
        resolved.set(id, {
            effective: baseEffective,
            origin: baseOrigin,
            agents: matrix.agents,
            agentDetails: matrix.agentDetails
        });
    }
    return resolved;
}
function isSkillEffectiveForAgent(resolution, agent) {
    if (!resolution) {
        return false;
    }
    if (resolution.agents && agent in resolution.agents) {
        return resolution.agents[agent] === true;
    }
    const descriptor = agent_skill_registry_1.AGENT_SKILL_REGISTRY[agent];
    if (descriptor.capability === 'unsupported') {
        return false;
    }
    return resolution.effective === 'enabled';
}
