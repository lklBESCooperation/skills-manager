"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.READONLY_SKILL_ERROR_CODE = exports.STATIC_READONLY_SKILL_MARKERS = exports.PluginSkillScopeSchema = exports.PluginSkillActivationStateSchema = exports.PluginSkillSourceCategorySchema = void 0;
exports.isStaticReadonlySkillPath = isStaticReadonlySkillPath;
exports.isPathInsideReadonlyRoots = isPathInsideReadonlyRoots;
const zod_1 = require("zod");
const skill_path_containment_1 = require("./skill-path-containment");
exports.PluginSkillSourceCategorySchema = zod_1.z.enum(['plugin', 'bundled-readonly']);
exports.PluginSkillActivationStateSchema = zod_1.z.enum([
    'active',
    'disabled-in-settings',
    'project-scoped-inactive',
    'wsl-unavailable',
    'unknown'
]);
exports.PluginSkillScopeSchema = zod_1.z.enum(['user', 'project', 'local']);
/**
 * Static path marker segments that are ALWAYS readonly plugin/bundled skill domains.
 * Checked lexically (and after realpath) to prevent any write/adopt/enablement/delete/pack mutation.
 */
exports.STATIC_READONLY_SKILL_MARKERS = [
    '/.claude/plugins/',
    '/.codex/plugins/',
    '/.codex/skills/.system/',
    '/etc/codex/skills/',
    '/.tmp/bundled-marketplaces/',
    '/.cursor/skills-cursor/',
    '/native-chat-visuals/',
    '/bot-linked-skills/'
];
exports.READONLY_SKILL_ERROR_CODE = 'skill-readonly-plugin-protected';
function forwardSlashed(path, semantics) {
    const normalized = (0, skill_path_containment_1.normalizedSkillPath)(path, semantics).replace(/\\/g, '/');
    return semantics.caseSensitive ? normalized : normalized.toLocaleLowerCase('en-US');
}
function isStaticReadonlySkillPath(targetPath, semantics = (0, skill_path_containment_1.nativeSkillPathSemantics)()) {
    const slashed = forwardSlashed(targetPath, semantics);
    const withTrailing = slashed.endsWith('/') ? slashed : `${slashed}/`;
    return exports.STATIC_READONLY_SKILL_MARKERS.some((marker) => {
        const normalizedMarker = semantics.caseSensitive
            ? marker
            : marker.toLocaleLowerCase('en-US');
        return withTrailing.includes(normalizedMarker);
    });
}
function isPathInsideReadonlyRoots(targetPath, context = {}) {
    const semantics = context.semantics ?? (0, skill_path_containment_1.nativeSkillPathSemantics)();
    if (isStaticReadonlySkillPath(targetPath, semantics)) {
        return true;
    }
    const roots = context.readonlyRoots ?? [];
    return roots.some((root) => (0, skill_path_containment_1.skillPathsEqual)(root, targetPath, semantics) || (0, skill_path_containment_1.skillPathInside)(root, targetPath, semantics));
}
