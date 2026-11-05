"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WINDOWS_SKILL_PATH_SEMANTICS = exports.POSIX_SKILL_PATH_SEMANTICS = void 0;
exports.nativeSkillPathSemantics = nativeSkillPathSemantics;
exports.normalizedSkillPath = normalizedSkillPath;
exports.skillPathsEqual = skillPathsEqual;
exports.skillPathInside = skillPathInside;
exports.skillPathDepthBelow = skillPathDepthBelow;
const node_path_1 = require("node:path");
exports.POSIX_SKILL_PATH_SEMANTICS = { caseSensitive: true, sep: '/' };
exports.WINDOWS_SKILL_PATH_SEMANTICS = { caseSensitive: false, sep: '\\' };
/** Semantics of the process's own filesystem. */
function nativeSkillPathSemantics(platform = process.platform) {
    return platform === 'win32' ? exports.WINDOWS_SKILL_PATH_SEMANTICS : exports.POSIX_SKILL_PATH_SEMANTICS;
}
function pathApi(semantics) {
    return semantics.sep === '\\' ? node_path_1.win32 : node_path_1.posix;
}
function comparable(path, semantics) {
    const resolved = pathApi(semantics).resolve(path);
    return semantics.caseSensitive ? resolved : resolved.toLocaleLowerCase('en-US');
}
function normalizedSkillPath(path, semantics) {
    return comparable(path, semantics);
}
function skillPathsEqual(left, right, semantics) {
    return comparable(left, semantics) === comparable(right, semantics);
}
/** True when `path` sits strictly below `root`; the root itself is not inside. */
function skillPathInside(root, path, semantics) {
    return relativeInside(root, path, semantics) !== null;
}
/** Segment count of `path` below `root`; null when `path` is not inside `root`. */
function skillPathDepthBelow(root, path, semantics) {
    const child = relativeInside(root, path, semantics);
    return child === null ? null : child.split(semantics.sep).length;
}
function relativeInside(root, path, semantics) {
    const api = pathApi(semantics);
    const child = api.relative(comparable(root, semantics), comparable(path, semantics));
    if (child === '' ||
        child === '..' ||
        child.startsWith(`..${semantics.sep}`) ||
        api.isAbsolute(child)) {
        return null;
    }
    return child;
}
