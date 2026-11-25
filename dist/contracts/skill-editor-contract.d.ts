import { z } from 'zod';
export declare const SKILL_ID_PATTERN: RegExp;
export declare const SkillEditorFileEntrySchema: z.ZodObject<{
    relativePath: z.ZodString;
    kind: z.ZodEnum<{
        directory: "directory";
        file: "file";
    }>;
    sizeBytes: z.ZodNumber;
}, z.core.$strict>;
export type SkillEditorFileEntry = z.infer<typeof SkillEditorFileEntrySchema>;
export declare const SkillCreateWizardInputSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
    author: z.ZodOptional<z.ZodString>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    instructions: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type SkillCreateWizardInput = z.input<typeof SkillCreateWizardInputSchema>;
export type SkillFrontmatterValidationResult = {
    valid: true;
    name: string;
    description: string;
    warnings: string[];
} | {
    valid: false;
    errors: string[];
};
export declare function validateSkillId(id: string): boolean;
export declare function validateSkillFrontmatter(markdown: string): SkillFrontmatterValidationResult;
export declare function renderSkillMarkdownTemplate(input: SkillCreateWizardInput): string;
