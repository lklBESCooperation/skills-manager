export type SkillFrontmatterSummary = {
    name: string | null;
    description: string | null;
};
export declare function summarizeSkillMarkdown(markdown: string): SkillFrontmatterSummary;
