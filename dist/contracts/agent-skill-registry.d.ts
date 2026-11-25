import { type TuiAgent } from './tui-agent';
export type AgentSkillCapability = 'managed' | 'discovery-only' | 'delegate' | 'unsupported';
export type AgentSkillDescriptor = {
    readonly id: TuiAgent;
    readonly displayName: string;
    readonly capability: AgentSkillCapability;
    readonly delegatesTo?: TuiAgent;
    /** Whether the agent reads `.agents/skills` under each scope. */
    readonly readsCanonical: {
        readonly global: boolean;
        readonly workspace: boolean;
    };
    /** Single-source write/link target segments; null means canonical `.agents/skills`. */
    readonly installTargets: {
        readonly globalSegments: readonly string[] | null;
        readonly workspaceSegments: readonly string[] | null;
        /** Env var relocating the agent's home for installation (`<home>/skills`). */
        readonly homeEnv?: string;
    };
    /** Extra roots scanned for discovery & Adopt only (never written on install/enable). */
    readonly discoveryOnlyRoots?: {
        readonly globalSegments?: readonly (readonly string[])[];
        readonly workspaceSegments?: readonly (readonly string[])[];
        readonly customHomeResolver?: 'hermes-platform-home';
        readonly acpHomeEnv?: string;
    };
    /** Former install roots now retired and cleaned up when migrating to canonical. */
    readonly retiredInstallRoots?: readonly (readonly string[])[];
    /** Cross-agent skill folder borrowing (read-only visibility derivation). */
    readonly borrowedOwners?: {
        readonly global?: readonly TuiAgent[];
        readonly workspace?: readonly TuiAgent[];
    };
    /** Built-in readonly directories shipped by the agent itself. */
    readonly bundledReadonlySegments?: readonly (readonly string[])[];
};
/**
 * Compile-time single source of truth covering all 45 TuiAgent entries.
 * `SKILL_INSTALL_PROVIDERS` and discovery/borrowing helpers derive from this table.
 */
export declare const AGENT_SKILL_REGISTRY: {
    readonly codex: AgentSkillDescriptor;
    readonly claude: {
        readonly id: 'claude';
        readonly displayName: 'Claude Code';
        readonly capability: 'managed';
        readonly readsCanonical: {
            readonly global: false;
            readonly workspace: false;
        };
        readonly installTargets: {
            readonly globalSegments: readonly [".claude", "skills"];
            readonly workspaceSegments: readonly [".claude", "skills"];
            readonly homeEnv: 'CLAUDE_CONFIG_DIR';
        };
    };
    readonly 'claude-agent-teams': {
        readonly id: 'claude-agent-teams';
        readonly displayName: 'Claude Agent Teams';
        readonly capability: 'delegate';
        readonly delegatesTo: 'claude';
        readonly readsCanonical: {
            readonly global: false;
            readonly workspace: false;
        };
        readonly installTargets: {
            readonly globalSegments: null;
            readonly workspaceSegments: null;
        };
    };
    readonly cursor: {
        readonly id: 'cursor';
        readonly displayName: 'Cursor';
        readonly capability: 'managed';
        readonly readsCanonical: {
            readonly global: true;
            readonly workspace: true;
        };
        readonly installTargets: {
            readonly globalSegments: readonly [".cursor", "skills"];
            readonly workspaceSegments: null;
        };
        readonly discoveryOnlyRoots: {
            readonly workspaceSegments: readonly [readonly [".cursor", "skills"]];
            readonly acpHomeEnv: 'CURSOR_CONFIG_DIR';
        };
        readonly borrowedOwners: {
            readonly global: readonly ["claude", "codex", "grok"];
            readonly workspace: readonly ["claude", "codex", "grok"];
        };
        readonly bundledReadonlySegments: readonly [readonly [".cursor", "skills-cursor"]];
    };
    readonly gemini: AgentSkillDescriptor;
    readonly droid: {
        readonly id: 'droid';
        readonly displayName: 'Droid';
        readonly capability: 'managed';
        readonly readsCanonical: {
            readonly global: true;
            readonly workspace: true;
        };
        readonly installTargets: {
            readonly globalSegments: readonly [".factory", "skills"];
            readonly workspaceSegments: readonly [".factory", "skills"];
        };
        readonly discoveryOnlyRoots: {
            readonly acpHomeEnv: 'FACTORY_HOME_OVERRIDE';
        };
    };
    readonly continue: {
        readonly id: 'continue';
        readonly displayName: 'Continue';
        readonly capability: 'managed';
        readonly readsCanonical: {
            readonly global: true;
            readonly workspace: true;
        };
        readonly installTargets: {
            readonly globalSegments: readonly [".continue", "skills"];
            readonly workspaceSegments: readonly [".continue", "skills"];
        };
    };
    readonly trae: {
        readonly id: 'trae';
        readonly displayName: 'Trae';
        readonly capability: 'managed';
        readonly readsCanonical: {
            readonly global: true;
            readonly workspace: true;
        };
        readonly installTargets: {
            readonly globalSegments: readonly [".trae-cn", "skills"];
            readonly workspaceSegments: readonly [".trae", "skills"];
        };
    };
    readonly grok: {
        readonly id: 'grok';
        readonly displayName: 'Grok';
        readonly capability: 'managed';
        readonly readsCanonical: {
            readonly global: true;
            readonly workspace: true;
        };
        readonly installTargets: {
            readonly globalSegments: readonly [".grok", "skills"];
            readonly workspaceSegments: readonly [".grok", "skills"];
            readonly homeEnv: 'GROK_HOME';
        };
    };
    readonly aug: {
        readonly id: 'aug';
        readonly displayName: 'Augment';
        readonly capability: 'managed';
        readonly readsCanonical: {
            readonly global: true;
            readonly workspace: true;
        };
        readonly installTargets: {
            readonly globalSegments: readonly [".augment", "skills"];
            readonly workspaceSegments: readonly [".augment", "skills"];
        };
        readonly discoveryOnlyRoots: {
            readonly acpHomeEnv: 'AUGMENT_CACHE_DIR';
        };
        readonly borrowedOwners: {
            readonly global: readonly ["claude"];
            readonly workspace: readonly ["claude"];
        };
    };
    readonly muse: AgentSkillDescriptor;
    readonly zcode: {
        readonly id: 'zcode';
        readonly displayName: 'ZCode';
        readonly capability: 'managed';
        readonly readsCanonical: {
            readonly global: true;
            readonly workspace: true;
        };
        readonly installTargets: {
            readonly globalSegments: readonly [".zcode", "skills"];
            readonly workspaceSegments: null;
        };
    };
    readonly codebuddy: {
        readonly id: 'codebuddy';
        readonly displayName: 'CodeBuddy';
        readonly capability: 'managed';
        readonly readsCanonical: {
            readonly global: true;
            readonly workspace: true;
        };
        readonly installTargets: {
            readonly globalSegments: readonly [".codebuddy", "skills"];
            readonly workspaceSegments: readonly [".codebuddy", "skills"];
        };
        readonly discoveryOnlyRoots: {
            readonly acpHomeEnv: 'CODEBUDDY_CONFIG_DIR';
        };
    };
    readonly kiro: {
        readonly id: 'kiro';
        readonly displayName: 'Kiro';
        readonly capability: 'managed';
        readonly readsCanonical: {
            readonly global: true;
            readonly workspace: true;
        };
        readonly installTargets: {
            readonly globalSegments: readonly [".kiro", "skills"];
            readonly workspaceSegments: readonly [".kiro", "skills"];
            readonly homeEnv: 'KIRO_HOME';
        };
    };
    readonly antigravity: {
        readonly id: 'antigravity';
        readonly displayName: 'Antigravity';
        readonly capability: 'managed';
        readonly readsCanonical: {
            readonly global: true;
            readonly workspace: true;
        };
        readonly installTargets: {
            readonly globalSegments: readonly [".gemini", "config", "skills"];
            readonly workspaceSegments: null;
        };
        readonly discoveryOnlyRoots: {
            readonly globalSegments: readonly [readonly [".gemini", "antigravity-cli", "skills"]];
            readonly acpHomeEnv: 'GEMINI_HOME';
        };
    };
    readonly openclaude: {
        readonly id: 'openclaude';
        readonly displayName: 'OpenClaude';
        readonly capability: 'managed';
        readonly readsCanonical: {
            readonly global: true;
            readonly workspace: true;
        };
        readonly installTargets: {
            readonly globalSegments: readonly [".openclaude", "skills"];
            readonly workspaceSegments: readonly [".openclaude", "skills"];
            readonly homeEnv: 'OPENCLAUDE_CONFIG_DIR';
        };
        readonly borrowedOwners: {
            readonly global: readonly ["claude"];
            readonly workspace: readonly ["claude"];
        };
    };
    readonly autohand: AgentSkillDescriptor;
    readonly goose: AgentSkillDescriptor;
    readonly crush: AgentSkillDescriptor;
    readonly 'command-code': AgentSkillDescriptor;
    readonly 'mistral-vibe': AgentSkillDescriptor;
    readonly 'qwen-code': AgentSkillDescriptor;
    readonly rovo: AgentSkillDescriptor;
    readonly openclaw: AgentSkillDescriptor;
    readonly devin: AgentSkillDescriptor;
    readonly opencode: AgentSkillDescriptor;
    readonly pi: AgentSkillDescriptor;
    readonly amp: AgentSkillDescriptor;
    readonly kilo: AgentSkillDescriptor;
    readonly cline: AgentSkillDescriptor;
    readonly kimi: AgentSkillDescriptor;
    readonly copilot: AgentSkillDescriptor;
    readonly opencode2: AgentSkillDescriptor;
    readonly 'mimo-code': AgentSkillDescriptor;
    readonly omp: AgentSkillDescriptor;
    readonly 'prime-agent': AgentSkillDescriptor;
    readonly qoder: AgentSkillDescriptor;
    readonly 'qoder-cn': AgentSkillDescriptor;
    readonly codebuff: AgentSkillDescriptor;
    readonly freebuff: AgentSkillDescriptor;
    readonly ante: AgentSkillDescriptor;
    readonly jcode: AgentSkillDescriptor;
    readonly dsh: AgentSkillDescriptor;
    readonly hermes: {
        readonly id: 'hermes';
        readonly displayName: 'Hermes Agent';
        readonly capability: 'discovery-only';
        readonly readsCanonical: {
            readonly global: false;
            readonly workspace: false;
        };
        readonly installTargets: {
            readonly globalSegments: null;
            readonly workspaceSegments: null;
        };
        readonly discoveryOnlyRoots: {
            readonly globalSegments: readonly [readonly [".hermes", "skills"]];
            readonly customHomeResolver: 'hermes-platform-home';
            readonly acpHomeEnv: 'HERMES_HOME';
        };
    };
    readonly aider: {
        readonly id: 'aider';
        readonly displayName: 'Aider';
        readonly capability: 'unsupported';
        readonly readsCanonical: {
            readonly global: false;
            readonly workspace: false;
        };
        readonly installTargets: {
            readonly globalSegments: null;
            readonly workspaceSegments: null;
        };
    };
};
export declare const AGENT_SKILL_DESCRIPTORS: readonly AgentSkillDescriptor[];
export declare function getAgentSkillDescriptor(agent: TuiAgent): AgentSkillDescriptor;
export declare function getAgentBorrowedOwners(agent: TuiAgent, scope: 'global' | 'workspace'): readonly TuiAgent[];
export declare function getAgentDiscoverySegments(agent: TuiAgent, scope: 'global' | 'workspace'): readonly (readonly string[])[];
