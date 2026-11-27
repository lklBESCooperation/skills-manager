import { z } from 'zod';
import type { PluginSkillRecord } from './plugin-skill-contract';
import type { SkillAuditReport } from './skill-audit-contract';
import type { AgentId, EffectiveAgentSkillState, EffectiveSkillState, SkillEnablementOrigin } from './skill-enablement';
import { type SkillPackExportBundle, type SkillPackOperationMode, type SkillPackPreviewDiff, type SkillPackScope, type SkillPackUndoSnapshot, type SkillPackV2 } from './skill-pack-contract';
import type { CopyModePlacementState } from './skill-vault-contract';
export declare const SKILL_BRIDGE_METHODS: {
    readonly workbenchSnapshot: 'skills.workbench.snapshot';
    readonly panelSnapshot: 'skills.panel.snapshot';
    readonly enablementMutate: 'skills.enablement.mutate';
    readonly pluginsRescan: 'skills.plugins.rescan';
    readonly vaultAdopt: 'skills.vault.adopt';
    readonly packsList: 'skills.packs.list';
    readonly packsSaveCurrent: 'skills.packs.saveCurrent';
    readonly packsSave: 'skills.packs.save';
    readonly packsDelete: 'skills.packs.delete';
    readonly packsPreview: 'skills.packs.preview';
    readonly packsApply: 'skills.packs.apply';
    readonly packsRollback: 'skills.packs.rollback';
    readonly packsExport: 'skills.packs.export';
    readonly packsImport: 'skills.packs.import';
    readonly auditRun: 'skills.audit.run';
};
export declare const SKILL_BRIDGE_EVENTS: {
    readonly skillsChanged: 'skills.changed';
    readonly contextChanged: 'skills.contextChanged';
};
export type ManagedSkillSourceKind = 'installed' | 'adopted' | 'bundled' | 'canonical-unindexed';
export type SkillScopeKind = 'user' | 'workspace';
export type WorkspaceContextSummary = {
    workspaceId: string | null;
    workspaceName: string | null;
    /** Only true when focused workspace is local (`hostId === null || hostId === 'local'`). */
    isLocalDirectoryAvailable: boolean;
};
export type AgentRegistrySummaryItem = {
    id: AgentId;
    displayName: string;
    capability: 'managed' | 'discovery-only' | 'delegate' | 'unsupported';
    readsCanonical: boolean;
    delegatesTo?: AgentId;
};
export type ManagedSkillViewItem = {
    /** Stable unique row key (`${scope}:${id}`). */
    rowKey: string;
    id: string;
    name: string;
    description: string | null;
    sourceKind: ManagedSkillSourceKind;
    scope: SkillScopeKind;
    tags: string[];
    author: string | null;
    copyMode: boolean;
    copyModeState?: CopyModePlacementState;
    effective: EffectiveSkillState;
    origin: SkillEnablementOrigin;
    enabledAgentCount: number;
    supportedAgentCount: number;
    agents: Partial<Record<AgentId, boolean>>;
    agentDetails: Partial<Record<AgentId, EffectiveAgentSkillState>>;
};
export type AdoptableSkillViewItem = {
    rowKey: string;
    id: string;
    name: string;
    description: string | null;
    scope: SkillScopeKind;
    disposition: 'adoptable' | 'conflict';
    digest: string;
    originPath: string;
    mergePaths: string[];
    conflictCount: number;
};
export type WorkbenchSnapshotOutput = {
    activeWorkspace: WorkspaceContextSummary;
    agentRegistry: AgentRegistrySummaryItem[];
    managedSkills: ManagedSkillViewItem[];
    adoptableSkills: AdoptableSkillViewItem[];
    pluginSkills: PluginSkillRecord[];
    pluginScanError: string | null;
    generatedAt: number;
};
export type QuickPanelSkillItem = Omit<ManagedSkillViewItem, 'agents' | 'agentDetails'>;
export type QuickPanelSnapshotOutput = {
    activeWorkspace: WorkspaceContextSummary;
    managedSkills: QuickPanelSkillItem[];
    pluginSkillCount: number;
    adoptableCount: number;
    generatedAt: number;
};
export declare const SkillMutateInputSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        disable: "disable";
        enable: "enable";
        inherit: "inherit";
    }>;
    skillIds: z.ZodArray<z.ZodString>;
    writeScope: z.ZodEnum<{
        project: "project";
        user: "user";
    }>;
    skillScope: z.ZodOptional<z.ZodEnum<{
        user: "user";
        workspace: "workspace";
    }>>;
    agents: z.ZodOptional<z.ZodRecord<z.ZodEnum<{
        aider: "aider";
        amp: "amp";
        ante: "ante";
        antigravity: "antigravity";
        aug: "aug";
        autohand: "autohand";
        claude: "claude";
        "claude-agent-teams": "claude-agent-teams";
        cline: "cline";
        codebuddy: "codebuddy";
        codebuff: "codebuff";
        codex: "codex";
        "command-code": "command-code";
        continue: "continue";
        copilot: "copilot";
        crush: "crush";
        cursor: "cursor";
        devin: "devin";
        droid: "droid";
        dsh: "dsh";
        freebuff: "freebuff";
        gemini: "gemini";
        goose: "goose";
        grok: "grok";
        hermes: "hermes";
        jcode: "jcode";
        kilo: "kilo";
        kimi: "kimi";
        kiro: "kiro";
        "mimo-code": "mimo-code";
        "mistral-vibe": "mistral-vibe";
        muse: "muse";
        omp: "omp";
        openclaude: "openclaude";
        openclaw: "openclaw";
        opencode: "opencode";
        opencode2: "opencode2";
        pi: "pi";
        "prime-agent": "prime-agent";
        qoder: "qoder";
        "qoder-cn": "qoder-cn";
        "qwen-code": "qwen-code";
        rovo: "rovo";
        trae: "trae";
        zcode: "zcode";
    }> & z.core.$partial, z.ZodBoolean>>;
}, z.core.$strict>;
export type SkillMutateInput = z.infer<typeof SkillMutateInputSchema>;
export type SkillMutateConflictItem = {
    skillId: string;
    provider: string;
    rootPath: string;
};
export type SkillMutateOutput = {
    status: 'applied' | 'partial' | 'conflict';
    updatedSkills: ManagedSkillViewItem[];
    conflicts: SkillMutateConflictItem[];
    readonlyBlocked: SkillMutateConflictItem[];
    failed: {
        skillId: string;
        error: string;
    }[];
};
export declare const SkillAdoptInputSchema: z.ZodObject<{
    scope: z.ZodEnum<{
        user: "user";
        workspace: "workspace";
    }>;
    skillIds: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type SkillAdoptInput = z.infer<typeof SkillAdoptInputSchema>;
export type SkillAdoptOutput = {
    adoptedIds: string[];
    skippedReadonly: string[];
    conflicts: string[];
    failed: {
        skillId: string;
        error: string;
    }[];
};
export declare const PackScopeInputSchema: z.ZodObject<{
    scope: z.ZodEnum<{
        project: "project";
        user: "user";
    }>;
}, z.core.$strict>;
export declare const PackSaveCurrentInputSchema: z.ZodObject<{
    scope: z.ZodEnum<{
        project: "project";
        user: "user";
    }>;
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const PackSaveInputSchema: z.ZodObject<{
    scope: z.ZodEnum<{
        project: "project";
        user: "user";
    }>;
    pack: z.ZodUnion<readonly [z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        members: z.ZodArray<z.ZodString>;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
        dynamic: z.ZodUnion<readonly [z.ZodObject<{
            match: z.ZodArray<z.ZodObject<{
                field: z.ZodEnum<{
                    author: "author";
                    namePrefix: "namePrefix";
                    sourceKind: "sourceKind";
                    tag: "tag";
                }>;
                op: z.ZodEnum<{
                    eq: "eq";
                    in: "in";
                    prefix: "prefix";
                }>;
                value: z.ZodString;
            }, z.core.$strict>>;
            logic: z.ZodLiteral<"and">;
        }, z.core.$strict>, z.ZodObject<{
            logic: z.ZodEnum<{
                and: "and";
                or: "or";
            }>;
            conditions: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                field: z.ZodEnum<{
                    agent: "agent";
                    author: "author";
                    enabled: "enabled";
                    namePrefix: "namePrefix";
                    originRoot: "originRoot";
                    scope: "scope";
                    sourceKind: "sourceKind";
                    tag: "tag";
                }>;
                op: z.ZodEnum<{
                    contains: "contains";
                    eq: "eq";
                    in: "in";
                    neq: "neq";
                    not_in: "not_in";
                    prefix: "prefix";
                }>;
                value: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                logic: z.ZodEnum<{
                    and: "and";
                    or: "or";
                }>;
                conditions: z.ZodArray<z.ZodObject<{
                    field: z.ZodEnum<{
                        agent: "agent";
                        author: "author";
                        enabled: "enabled";
                        namePrefix: "namePrefix";
                        originRoot: "originRoot";
                        scope: "scope";
                        sourceKind: "sourceKind";
                        tag: "tag";
                    }>;
                    op: z.ZodEnum<{
                        contains: "contains";
                        eq: "eq";
                        in: "in";
                        neq: "neq";
                        not_in: "not_in";
                        prefix: "prefix";
                    }>;
                    value: z.ZodString;
                }, z.core.$strict>>;
            }, z.core.$strict>]>>;
        }, z.core.$strict>]>;
    }, z.core.$strict>]>;
}, z.core.$strict>;
export declare const PackIdInputSchema: z.ZodObject<{
    scope: z.ZodEnum<{
        project: "project";
        user: "user";
    }>;
    id: z.ZodString;
}, z.core.$strict>;
export declare const PackModeInputSchema: z.ZodObject<{
    scope: z.ZodEnum<{
        project: "project";
        user: "user";
    }>;
    id: z.ZodString;
    mode: z.ZodEnum<{
        apply: "apply";
        switch: "switch";
    }>;
}, z.core.$strict>;
export declare const PackRollbackInputSchema: z.ZodObject<{
    scope: z.ZodEnum<{
        project: "project";
        user: "user";
    }>;
    undoId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const PackImportInputSchema: z.ZodObject<{
    scope: z.ZodEnum<{
        project: "project";
        user: "user";
    }>;
    bundle: z.ZodObject<{
        format: z.ZodLiteral<"pmstudio-pack-v1">;
        exportedAt: z.ZodISODateTime;
        pack: z.ZodUnion<readonly [z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            members: z.ZodArray<z.ZodString>;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
            dynamic: z.ZodUnion<readonly [z.ZodObject<{
                match: z.ZodArray<z.ZodObject<{
                    field: z.ZodEnum<{
                        author: "author";
                        namePrefix: "namePrefix";
                        sourceKind: "sourceKind";
                        tag: "tag";
                    }>;
                    op: z.ZodEnum<{
                        eq: "eq";
                        in: "in";
                        prefix: "prefix";
                    }>;
                    value: z.ZodString;
                }, z.core.$strict>>;
                logic: z.ZodLiteral<"and">;
            }, z.core.$strict>, z.ZodObject<{
                logic: z.ZodEnum<{
                    and: "and";
                    or: "or";
                }>;
                conditions: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    field: z.ZodEnum<{
                        agent: "agent";
                        author: "author";
                        enabled: "enabled";
                        namePrefix: "namePrefix";
                        originRoot: "originRoot";
                        scope: "scope";
                        sourceKind: "sourceKind";
                        tag: "tag";
                    }>;
                    op: z.ZodEnum<{
                        contains: "contains";
                        eq: "eq";
                        in: "in";
                        neq: "neq";
                        not_in: "not_in";
                        prefix: "prefix";
                    }>;
                    value: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    logic: z.ZodEnum<{
                        and: "and";
                        or: "or";
                    }>;
                    conditions: z.ZodArray<z.ZodObject<{
                        field: z.ZodEnum<{
                            agent: "agent";
                            author: "author";
                            enabled: "enabled";
                            namePrefix: "namePrefix";
                            originRoot: "originRoot";
                            scope: "scope";
                            sourceKind: "sourceKind";
                            tag: "tag";
                        }>;
                        op: z.ZodEnum<{
                            contains: "contains";
                            eq: "eq";
                            in: "in";
                            neq: "neq";
                            not_in: "not_in";
                            prefix: "prefix";
                        }>;
                        value: z.ZodString;
                    }, z.core.$strict>>;
                }, z.core.$strict>]>>;
            }, z.core.$strict>]>;
        }, z.core.$strict>]>;
        cloudRefs: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            packageId: z.ZodString;
            shareLink: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
    }, z.core.$strict>;
    conflictStrategy: z.ZodOptional<z.ZodEnum<{
        overwrite: "overwrite";
        reject: "reject";
        rename: "rename";
    }>>;
}, z.core.$strict>;
export type PackListEntryView = {
    pack: SkillPackV2;
    missing: string[];
};
export type PackListOutput = {
    scope: SkillPackScope;
    entries: PackListEntryView[];
    undoSnapshots: SkillPackUndoSnapshot[];
    error: string | null;
};
export type PackPreviewOutput = {
    id: string;
    mode: SkillPackOperationMode;
    diff: SkillPackPreviewDiff;
    hitIds?: string[];
};
export type PackApplyOutput = {
    id: string;
    mode: SkillPackOperationMode;
    diff: SkillPackPreviewDiff;
    undoId?: string;
    hitIds?: string[];
};
export type PackRollbackOutput = {
    snapshot: SkillPackUndoSnapshot;
};
export type PackImportOutput = {
    pack: SkillPackV2;
    missing: string[];
};
export type PackExportOutput = SkillPackExportBundle;
export type SkillsChangedPayload = {
    writeScope: 'user' | 'project';
    skillIds: string[];
    updatedAt: number;
};
export type PluginsRescanOutput = {
    pluginSkills: PluginSkillRecord[];
    pluginScanError: string | null;
};
export type AuditRunOutput = SkillAuditReport;
