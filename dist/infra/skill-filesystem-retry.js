"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renameSkillPathWithWindowsRetry = renameSkillPathWithWindowsRetry;
const promises_1 = require("node:fs/promises");
const WINDOWS_RENAME_RETRY_DELAYS_MS = [50, 100, 150, 200, 250];
async function renameSkillPathWithWindowsRetry(source, target) {
    for (let attempt = 0;; attempt += 1) {
        try {
            await (0, promises_1.rename)(source, target);
            return;
        }
        catch (error) {
            const code = error.code;
            const retryable = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
            if (process.platform !== 'win32' ||
                !retryable ||
                attempt >= WINDOWS_RENAME_RETRY_DELAYS_MS.length) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, WINDOWS_RENAME_RETRY_DELAYS_MS[attempt]));
        }
    }
}
