import { z } from 'zod';
export declare const SkillInstallFailureCategorySchema: z.ZodEnum<{
    admission: "admission";
    archive: "archive";
    cancelled: "cancelled";
    compatibility: "compatibility";
    conflict: "conflict";
    filesystem: "filesystem";
    "provider-placement": "provider-placement";
    recovery: "recovery";
    transport: "transport";
}>;
export type SkillInstallFailureCategory = z.infer<typeof SkillInstallFailureCategorySchema>;
export declare const SkillInstallFailureSchema: z.ZodObject<{
    category: z.ZodEnum<{
        admission: "admission";
        archive: "archive";
        cancelled: "cancelled";
        compatibility: "compatibility";
        conflict: "conflict";
        filesystem: "filesystem";
        "provider-placement": "provider-placement";
        recovery: "recovery";
        transport: "transport";
    }>;
    code: z.ZodString;
    retryable: z.ZodBoolean;
}, z.core.$strict>;
export type SkillInstallFailure = z.infer<typeof SkillInstallFailureSchema>;
export declare const SKILL_INSTALL_RPC_ERROR_CODE = "skill_install_failure";
export declare const SKILL_INSTALL_BUSY_FAILURE: SkillInstallFailure;
export declare const SKILL_INSTALL_CANCELLED_FAILURE: SkillInstallFailure;
export declare function classifySkillInstallFailureCode(code: string): SkillInstallFailure | null;
