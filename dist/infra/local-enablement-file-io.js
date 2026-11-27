"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readFileBounded = readFileBounded;
exports.createLocalSkillEnablementFileIO = createLocalSkillEnablementFileIO;
const promises_1 = require("node:fs/promises");
const zod_1 = require("zod");
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
/**
 * Production stateless Zod salvage implementation: each `collectDrops` call
 * tracks dropped keys in a per-invocation array passed via closure so
 * concurrent calls never collide.
 */
function createStatelessSalvage() {
    let activeDrops = null;
    return {
        collectDrops: (parse) => {
            const previous = activeDrops;
            const current = [];
            activeDrops = current;
            try {
                return { value: parse(), droppedPaths: current };
            }
            finally {
                activeDrops = previous;
            }
        },
        salvagingRecord: ((_key, value) => zod_1.z.unknown().transform((raw, ctx) => {
            const clean = {};
            if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
                ctx.addIssue({ code: 'custom', message: 'expected record' });
                return clean;
            }
            for (const [entryKey, entryValue] of Object.entries(raw)) {
                if (entryKey === '__proto__' || entryKey === 'constructor' || entryKey === 'prototype') {
                    continue;
                }
                const parsed = value.safeParse(entryValue);
                if (parsed.success) {
                    clean[entryKey] = parsed.data;
                }
                else {
                    activeDrops?.push(entryKey);
                }
            }
            return clean;
        }))
    };
}
/**
 * Bounded file reader: validates `size <= maxBytes` before reading into memory
 * and stops reading if the file grows beyond `maxBytes`.
 */
async function readFileBounded(filePath, maxBytes = DEFAULT_MAX_FILE_BYTES) {
    const fileStat = await (0, promises_1.stat)(filePath);
    if (!fileStat.isFile()) {
        throw new Error(`skill-file-not-regular: ${filePath}`);
    }
    if (fileStat.size > maxBytes) {
        throw new Error(`skill-file-too-large: ${filePath} (${fileStat.size} > ${maxBytes})`);
    }
    const handle = await (0, promises_1.open)(filePath, 'r');
    try {
        const buffer = Buffer.allocUnsafe(fileStat.size);
        let offset = 0;
        while (offset < fileStat.size) {
            const { bytesRead } = await handle.read(buffer, offset, fileStat.size - offset, offset);
            if (bytesRead === 0) {
                break;
            }
            offset += bytesRead;
        }
        return { buffer: offset === fileStat.size ? buffer : buffer.subarray(0, offset) };
    }
    finally {
        await handle.close();
    }
}
function createLocalSkillEnablementFileIO(maxBytes = DEFAULT_MAX_FILE_BYTES) {
    return {
        salvage: createStatelessSalvage(),
        readFileBounded: (filePath, requestedLimit) => readFileBounded(filePath, requestedLimit ?? maxBytes)
    };
}
