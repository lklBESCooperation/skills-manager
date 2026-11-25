"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillCreateWizardInputSchema = exports.SkillEditorFileEntrySchema = exports.SKILL_ID_PATTERN = void 0;
exports.validateSkillId = validateSkillId;
exports.validateSkillFrontmatter = validateSkillFrontmatter;
exports.renderSkillMarkdownTemplate = renderSkillMarkdownTemplate;
const zod_1 = require("zod");
const skill_metadata_1 = require("./skill-metadata");
exports.SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
exports.SkillEditorFileEntrySchema = zod_1.z
    .object({
    relativePath: zod_1.z.string().min(1),
    kind: zod_1.z.enum(['file', 'directory']),
    sizeBytes: zod_1.z.number().int().nonnegative()
})
    .strict();
exports.SkillCreateWizardInputSchema = zod_1.z
    .object({
    id: zod_1.z.string().regex(exports.SKILL_ID_PATTERN, 'Skill id must be kebab-case'),
    name: zod_1.z.string().trim().min(1).max(256),
    description: zod_1.z.string().trim().min(1).max(2048),
    author: zod_1.z.string().trim().min(1).max(128).optional(),
    tags: zod_1.z.array(zod_1.z.string().trim().min(1).max(64)).max(32).default([]),
    instructions: zod_1.z.string().optional()
})
    .strict();
function validateSkillId(id) {
    return (id.length >= 1 &&
        id.length <= 128 &&
        exports.SKILL_ID_PATTERN.test(id) &&
        id !== 'constructor' &&
        id !== 'prototype');
}
function validateSkillFrontmatter(markdown) {
    const normalized = markdown.replace(/^\uFEFF/, '');
    const errors = [];
    const warnings = [];
    const frontmatterMatch = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(normalized);
    if (!frontmatterMatch) {
        errors.push('Missing YAML frontmatter block delimited by ---');
        return { valid: false, errors };
    }
    const declared = (0, skill_metadata_1.declaredSkillMetadata)(normalized);
    if (!declared) {
        errors.push('YAML frontmatter must declare non-empty `name` and `description` fields');
        return { valid: false, errors };
    }
    if (declared.name.length > 256) {
        errors.push('Frontmatter `name` exceeds 256 characters');
    }
    if (declared.description.length > 2048) {
        errors.push('Frontmatter `description` exceeds 2048 characters');
    }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(declared.name)) {
        errors.push('Frontmatter `name` contains disallowed control characters');
    }
    const body = normalized.slice(frontmatterMatch[0].length).trim();
    if (body.length === 0) {
        warnings.push('SKILL.md body is empty');
    }
    if (errors.length > 0) {
        return { valid: false, errors };
    }
    return {
        valid: true,
        name: declared.name,
        description: declared.description,
        warnings
    };
}
function renderSkillMarkdownTemplate(input) {
    const parsed = exports.SkillCreateWizardInputSchema.parse(input);
    const lines = [
        '---',
        `name: ${parsed.name}`,
        `description: ${parsed.description}`
    ];
    if (parsed.author) {
        lines.push(`author: ${parsed.author}`);
    }
    if (parsed.tags.length > 0) {
        lines.push('tags:');
        for (const tag of parsed.tags) {
            lines.push(`  - ${tag}`);
        }
    }
    lines.push('---', '', `# ${parsed.name}`, '');
    lines.push(parsed.instructions?.trim() || 'Describe when and how an agent should apply this skill.');
    lines.push('');
    return lines.join('\n');
}
