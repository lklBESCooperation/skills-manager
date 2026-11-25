"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReadonlySkillProtectedError = void 0;
exports.assertWritableSkillTarget = assertWritableSkillTarget;
exports.isReadonlySkillTarget = isReadonlySkillTarget;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const plugin_skill_contract_1 = require("../contracts/plugin-skill-contract");
class ReadonlySkillProtectedError extends Error {
    code = plugin_skill_contract_1.READONLY_SKILL_ERROR_CODE;
    targetPath;
    resolvedPath;
    failure = {
        category: 'admission',
        code: plugin_skill_contract_1.READONLY_SKILL_ERROR_CODE,
        retryable: false
    };
    constructor(targetPath, resolvedPath = null) {
        super(`${plugin_skill_contract_1.READONLY_SKILL_ERROR_CODE}: ${targetPath}`);
        this.name = 'ReadonlySkillProtectedError';
        this.targetPath = targetPath;
        this.resolvedPath = resolvedPath;
    }
}
exports.ReadonlySkillProtectedError = ReadonlySkillProtectedError;
async function resolveNormalizedReadonlyRoots(roots) {
    if (!roots || roots.length === 0) {
        return [];
    }
    const resolved = await Promise.all(roots.map(async (root) => {
        const real = await (0, promises_1.realpath)(root).catch(() => null);
        return real ? [root, real] : [root];
    }));
    return resolved.flat();
}
/**
 * Resolves `targetPath` through symlinks on the target itself or its nearest existing ancestor
 * so symlink penetration into plugin/bundled roots is blocked even before the file exists.
 */
async function resolveTargetRealPath(targetPath) {
    const direct = await (0, promises_1.realpath)(targetPath).catch(() => null);
    if (direct !== null) {
        return direct;
    }
    const abs = (0, node_path_1.resolve)(targetPath);
    const missingSegments = [];
    let cursor = abs;
    for (;;) {
        const stat = await (0, promises_1.lstat)(cursor).catch(() => null);
        if (stat) {
            const realCursor = await (0, promises_1.realpath)(cursor).catch(() => cursor);
            return missingSegments.length > 0
                ? (0, node_path_1.join)(realCursor, ...missingSegments.toReversed())
                : realCursor;
        }
        const parent = (0, node_path_1.dirname)(cursor);
        if (parent === cursor) {
            return null;
        }
        const segment = cursor.slice(parent.length).replace(/^[/\\]+/, '');
        if (segment) {
            missingSegments.push(segment);
        }
        cursor = parent;
    }
}
/**
 * Dual-layer write fence: blocks any target whose lexical path OR resolved realpath sits
 * inside static plugin/bundled prefixes or dynamic plugin installation roots.
 */
async function assertWritableSkillTarget(targetPath, context = {}) {
    const expandedRoots = await resolveNormalizedReadonlyRoots(context.readonlyRoots);
    const effectiveContext = {
        ...context,
        readonlyRoots: expandedRoots
    };
    if ((0, plugin_skill_contract_1.isPathInsideReadonlyRoots)(targetPath, effectiveContext)) {
        throw new ReadonlySkillProtectedError(targetPath, null);
    }
    const realTarget = await resolveTargetRealPath(targetPath);
    if (realTarget !== null && (0, plugin_skill_contract_1.isPathInsideReadonlyRoots)(realTarget, effectiveContext)) {
        throw new ReadonlySkillProtectedError(targetPath, realTarget);
    }
}
async function isReadonlySkillTarget(targetPath, context = {}) {
    try {
        await assertWritableSkillTarget(targetPath, context);
        return false;
    }
    catch (error) {
        if (error instanceof ReadonlySkillProtectedError) {
            return true;
        }
        throw error;
    }
}
