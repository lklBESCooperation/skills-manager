"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WINDOWS_SKILL_PATH_SEMANTICS = exports.POSIX_SKILL_PATH_SEMANTICS = void 0;
exports.nativeSkillPathSemantics = nativeSkillPathSemantics;
exports.normalizedSkillPath = normalizedSkillPath;
exports.skillPathsEqual = skillPathsEqual;
exports.skillPathInside = skillPathInside;
exports.skillPathDepthBelow = skillPathDepthBelow;
exports.POSIX_SKILL_PATH_SEMANTICS = { caseSensitive: true, sep: '/' };
exports.WINDOWS_SKILL_PATH_SEMANTICS = { caseSensitive: false, sep: '\\' };
/** Semantics of the process's own filesystem without importing `node:*` modules. */
function nativeSkillPathSemantics(platform) {
    const detected = platform ?? globalThis.process?.platform ?? 'linux';
    return detected === 'win32' ? exports.WINDOWS_SKILL_PATH_SEMANTICS : exports.POSIX_SKILL_PATH_SEMANTICS;
}
function collapseSegments(segments, allowLeadingDotDot) {
    const stack = [];
    for (const segment of segments) {
        if (!segment || segment === '.') {
            continue;
        }
        if (segment === '..') {
            if (stack.length > 0 && stack[stack.length - 1] !== '..') {
                stack.pop();
            }
            else if (allowLeadingDotDot) {
                stack.push('..');
            }
            continue;
        }
        stack.push(segment);
    }
    return stack;
}
function splitWin32Root(rawPath) {
    const slashed = rawPath.replace(/\//g, '\\');
    if (slashed.startsWith('\\\\')) {
        // UNC path: \\server\share\...
        const withoutPrefix = slashed.slice(2);
        const parts = withoutPrefix.split('\\').filter(Boolean);
        if (parts.length >= 2) {
            const root = `\\\\${parts[0]}\\${parts[1]}\\`;
            const rest = parts.slice(2).join('\\');
            return { root, rest };
        }
        return { root: '\\\\', rest: withoutPrefix };
    }
    if (/^[A-Za-z]:/.test(slashed)) {
        const drive = slashed.slice(0, 2);
        const afterDrive = slashed.slice(2);
        if (afterDrive.startsWith('\\')) {
            return { root: `${drive}\\`, rest: afterDrive.slice(1) };
        }
        return { root: drive, rest: afterDrive };
    }
    if (slashed.startsWith('\\')) {
        return { root: '\\', rest: slashed.slice(1) };
    }
    return { root: '', rest: slashed };
}
function resolvePure(rawPath, semantics) {
    if (semantics.sep === '\\') {
        const { root, rest } = splitWin32Root(rawPath);
        const isAbs = root.endsWith('\\');
        const segments = collapseSegments(rest.split('\\'), !isAbs);
        if (!root) {
            return segments.length > 0 ? segments.join('\\') : '.';
        }
        if (isAbs) {
            return `${root}${segments.join('\\')}`;
        }
        return segments.length > 0 ? `${root}${segments.join('\\')}` : root;
    }
    const isAbs = rawPath.startsWith('/');
    const segments = collapseSegments(rawPath.split('/'), !isAbs);
    if (isAbs) {
        return `/${segments.join('/')}`;
    }
    return segments.length > 0 ? segments.join('/') : '.';
}
function comparable(path, semantics) {
    const resolved = resolvePure(path, semantics);
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
    const normRoot = comparable(root, semantics);
    const normPath = comparable(path, semantics);
    if (normRoot === normPath) {
        return null;
    }
    const sep = semantics.sep;
    if (semantics.sep === '\\') {
        const rootParts = splitWin32Root(normRoot);
        const pathParts = splitWin32Root(normPath);
        if (rootParts.root !== pathParts.root) {
            return null;
        }
        const prefix = normRoot.endsWith('\\') ? normRoot : `${normRoot}\\`;
        if (!normPath.startsWith(prefix)) {
            return null;
        }
        const child = normPath.slice(prefix.length);
        return child.length > 0 ? child : null;
    }
    const prefix = normRoot === '/' ? '/' : `${normRoot}${sep}`;
    if (!normPath.startsWith(prefix)) {
        return null;
    }
    const child = normPath.slice(prefix.length);
    return child.length > 0 ? child : null;
}
