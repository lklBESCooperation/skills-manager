"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SKILL_INSTALL_CANCELLED_FAILURE = exports.SKILL_INSTALL_BUSY_FAILURE = exports.SKILL_INSTALL_RPC_ERROR_CODE = exports.SkillInstallFailureSchema = exports.SkillInstallFailureCategorySchema = void 0;
exports.classifySkillInstallFailureCode = classifySkillInstallFailureCode;
const zod_1 = require("zod");
exports.SkillInstallFailureCategorySchema = zod_1.z.enum([
    'admission',
    'transport',
    'archive',
    'filesystem',
    'conflict',
    'recovery',
    'provider-placement',
    'compatibility',
    'cancelled'
]);
exports.SkillInstallFailureSchema = zod_1.z
    .object({
    category: exports.SkillInstallFailureCategorySchema,
    code: zod_1.z.string().regex(/^skill-[a-z0-9-]+$/),
    retryable: zod_1.z.boolean()
})
    .strict();
exports.SKILL_INSTALL_RPC_ERROR_CODE = 'skill_install_failure';
exports.SKILL_INSTALL_BUSY_FAILURE = {
    category: 'filesystem',
    code: 'skill-install-busy',
    retryable: true
};
exports.SKILL_INSTALL_CANCELLED_FAILURE = {
    category: 'cancelled',
    code: 'skill-install-cancelled',
    retryable: true
};
function retryableCode(code) {
    return (code.includes('busy') ||
        code.includes('timeout') ||
        code.includes('transport') ||
        code.includes('expired') ||
        code.includes('unavailable') ||
        code.includes('failed'));
}
function classifySkillInstallFailureCode(code) {
    if (!/^skill-[a-z0-9-]+$/.test(code)) {
        return null;
    }
    if (code.includes('cancelled')) {
        return { category: 'cancelled', code, retryable: true };
    }
    if (code.includes('recovery') || code.includes('journal') || code.includes('receipt')) {
        return { category: 'recovery', code, retryable: retryableCode(code) };
    }
    if (code.startsWith('skill-placement-') || code.startsWith('skill-discovery-')) {
        return { category: 'provider-placement', code, retryable: retryableCode(code) };
    }
    if (code.includes('conflict') || code.includes('modified') || code.includes('unowned')) {
        return { category: 'conflict', code, retryable: false };
    }
    if (code.startsWith('skill-package-')) {
        return { category: 'archive', code, retryable: false };
    }
    if (code.startsWith('skill-download-') ||
        code.startsWith('skill-transfer-') ||
        code.startsWith('skill-cloud-')) {
        return { category: 'transport', code, retryable: retryableCode(code) };
    }
    if (code.includes('update-required') ||
        code.includes('unsupported') ||
        code.includes('remote-download-unavailable')) {
        return { category: 'compatibility', code, retryable: false };
    }
    if (code.includes('readonly') ||
        code.includes('destination') ||
        code.includes('workspace') ||
        code.includes('environment') ||
        code.includes('home-') ||
        code.includes('ingress') ||
        code.includes('ssh-relay-unavailable') ||
        code.includes('name-invalid') ||
        code.includes('wsl-unavailable') ||
        code.includes('path-escape')) {
        return { category: 'admission', code, retryable: false };
    }
    if (code.startsWith('skill-install-') ||
        code.startsWith('skill-remove-') ||
        code.startsWith('skill-removal-')) {
        return { category: 'filesystem', code, retryable: retryableCode(code) };
    }
    return null;
}
