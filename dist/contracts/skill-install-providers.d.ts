export declare const SKILL_INSTALL_PROVIDERS: readonly ({
    id: "codex";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
    homeEnv?: undefined;
} | {
    id: "claude";
    displayName: string;
    globalSegments: string[];
    workspaceSegments: string[];
    homeEnv: string;
} | {
    id: "cursor";
    displayName: string;
    globalSegments: string[];
    workspaceSegments: null;
    homeEnv?: undefined;
} | {
    id: "gemini";
    displayName: string;
    globalSegments: string[];
    workspaceSegments: null;
    homeEnv?: undefined;
} | {
    id: "droid";
    displayName: string;
    globalSegments: string[];
    workspaceSegments: string[];
    homeEnv?: undefined;
} | {
    id: "continue";
    displayName: string;
    globalSegments: string[];
    workspaceSegments: string[];
    homeEnv?: undefined;
} | {
    id: "trae";
    displayName: string;
    globalSegments: string[];
    workspaceSegments: string[];
    homeEnv?: undefined;
} | {
    id: "grok";
    displayName: string;
    globalSegments: string[];
    workspaceSegments: string[];
    homeEnv: string;
} | {
    id: "aug";
    displayName: string;
    globalSegments: string[];
    workspaceSegments: string[];
    homeEnv?: undefined;
} | {
    id: "muse";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
    homeEnv?: undefined;
} | {
    id: "zcode";
    displayName: string;
    globalSegments: string[];
    workspaceSegments: null;
    homeEnv?: undefined;
} | {
    id: "codebuddy";
    displayName: string;
    globalSegments: string[];
    workspaceSegments: string[];
    homeEnv?: undefined;
} | {
    id: "kiro";
    displayName: string;
    globalSegments: string[];
    workspaceSegments: string[];
    homeEnv: string;
} | {
    id: "antigravity";
    displayName: string;
    globalSegments: string[];
    workspaceSegments: null;
    homeEnv?: undefined;
} | {
    id: "openclaude";
    displayName: string;
    globalSegments: string[];
    workspaceSegments: string[];
    homeEnv: string;
} | {
    homeEnv?: undefined;
    id: "autohand";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "goose";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "crush";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "command-code";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "mistral-vibe";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "qwen-code";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "rovo";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "openclaw";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "devin";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "opencode";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "pi";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "amp";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "kilo";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "cline";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "kimi";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "copilot";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "opencode2";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "mimo-code";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "omp";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "prime-agent";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "qoder";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "qoder-cn";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "codebuff";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "freebuff";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "ante";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "jcode";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
} | {
    homeEnv?: undefined;
    id: "dsh";
    displayName: string;
    globalSegments: null;
    workspaceSegments: null;
})[];
export type SkillInstallProviderDefinition = (typeof SKILL_INSTALL_PROVIDERS)[number];
export type SkillInstallProviderId = SkillInstallProviderDefinition['id'];
export declare function isSkillInstallProviderId(value: string): value is SkillInstallProviderId;
/** Explicit choices include agents installed later; removal omits choices to clean every previously used root. */
export declare function selectedOrDetectedSkillProviders(detectedProviders: readonly string[], selectedProviders: readonly string[] | undefined): readonly string[];
