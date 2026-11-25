export type SkillFrontmatterSummary = {
    name: string | null;
    description: string | null;
};
export declare function summarizeSkillMarkdown(markdown: string): SkillFrontmatterSummary;
/** The name and description a SKILL.md declares in frontmatter; null when either is missing, so
 *  arbitrary text never stands in for them. */
export declare function declaredSkillMetadata(markdown: string): {
    name: string;
    description: string;
} | null;
