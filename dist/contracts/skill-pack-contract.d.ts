import { z } from 'zod';
export declare const DynamicPackConditionSchema: z.ZodObject<{
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
}, z.core.$strict>;
export declare const DynamicPackRuleSchema: z.ZodObject<{
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
}, z.core.$strict>;
/** V2 condition: 8 fields, 6 operators, 2-level nested and/or groups (Architect §3.2). */
export declare const DynamicPackConditionV2Schema: z.ZodObject<{
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
}, z.core.$strict>;
export declare const DynamicPackNestedGroupSchema: z.ZodObject<{
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
}, z.core.$strict>;
export declare const DynamicPackRuleV2Schema: z.ZodObject<{
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
}, z.core.$strict>;
export declare const StaticSkillPackSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    members: z.ZodArray<z.ZodString>;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export declare const DynamicSkillPackSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
    dynamic: z.ZodObject<{
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
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const DynamicSkillPackV2Schema: z.ZodObject<{
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
}, z.core.$strict>;
export declare const SkillPackSchema: z.ZodUnion<readonly [z.ZodObject<{
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
    dynamic: z.ZodObject<{
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
    }, z.core.$strict>;
}, z.core.$strict>]>;
export declare const SkillPackV2Schema: z.ZodUnion<readonly [z.ZodObject<{
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
export declare const isDynamicSkillPack: (pack: SkillPack | SkillPackV2) => pack is DynamicSkillPack | DynamicSkillPackV2;
export declare const isDynamicRuleV2: (rule: DynamicPackRule | DynamicPackRuleV2) => rule is DynamicPackRuleV2;
export declare const SkillPackOperationModeSchema: z.ZodEnum<{
    apply: "apply";
    switch: "switch";
}>;
export declare const SkillPackPreviewDiffSchema: z.ZodObject<{
    enable: z.ZodArray<z.ZodString>;
    disable: z.ZodArray<z.ZodString>;
    keep: z.ZodArray<z.ZodString>;
    missing: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const SkillPackFileSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    packs: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
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
        dynamic: z.ZodObject<{
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
        }, z.core.$strict>;
    }, z.core.$strict>]>>;
}, z.core.$strict>;
export declare const SkillPackFileV2Schema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<2>;
    packs: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
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
    }, z.core.$strict>]>>;
}, z.core.$strict>;
export declare const SkillPackCloudRefSchema: z.ZodObject<{
    packageId: z.ZodString;
    shareLink: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** Portable `.pmstudio-pack.json` format (machine paths stripped). */
export declare const SkillPackExportBundleSchema: z.ZodObject<{
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
export declare const SkillPackUndoSnapshotSchema: z.ZodObject<{
    undoId: z.ZodString;
    packId: z.ZodString;
    mode: z.ZodEnum<{
        apply: "apply";
        switch: "switch";
    }>;
    scope: z.ZodEnum<{
        project: "project";
        user: "user";
    }>;
    createdAt: z.ZodISODateTime;
    affectedSkillIds: z.ZodArray<z.ZodString>;
    previousEnabledIds: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const SkillPackUndoRingSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    snapshots: z.ZodArray<z.ZodObject<{
        undoId: z.ZodString;
        packId: z.ZodString;
        mode: z.ZodEnum<{
            apply: "apply";
            switch: "switch";
        }>;
        scope: z.ZodEnum<{
            project: "project";
            user: "user";
        }>;
        createdAt: z.ZodISODateTime;
        affectedSkillIds: z.ZodArray<z.ZodString>;
        previousEnabledIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type DynamicPackRule = z.infer<typeof DynamicPackRuleSchema>;
export type DynamicPackRuleCondition = DynamicPackRule['match'][number];
export type DynamicPackConditionV2 = z.infer<typeof DynamicPackConditionV2Schema>;
export type DynamicPackNestedGroup = z.infer<typeof DynamicPackNestedGroupSchema>;
export type DynamicPackRuleV2 = z.infer<typeof DynamicPackRuleV2Schema>;
export type StaticSkillPack = z.infer<typeof StaticSkillPackSchema>;
export type DynamicSkillPack = z.infer<typeof DynamicSkillPackSchema>;
export type DynamicSkillPackV2 = z.infer<typeof DynamicSkillPackV2Schema>;
export type SkillPack = z.infer<typeof SkillPackSchema>;
export type SkillPackV2 = z.infer<typeof SkillPackV2Schema>;
export type SkillPackOperationMode = z.infer<typeof SkillPackOperationModeSchema>;
export type SkillPackPreviewDiff = z.infer<typeof SkillPackPreviewDiffSchema>;
export type SkillPackFile = z.infer<typeof SkillPackFileSchema>;
export type SkillPackFileV2 = z.infer<typeof SkillPackFileV2Schema>;
export type SkillPackExportBundle = z.infer<typeof SkillPackExportBundleSchema>;
export type SkillPackUndoSnapshot = z.infer<typeof SkillPackUndoSnapshotSchema>;
export type SkillPackUndoRing = z.infer<typeof SkillPackUndoRingSchema>;
export type SkillPackScope = 'user' | 'project';
export type SkillPackReadResult = {
    packs: SkillPackV2[];
    error: string | null;
};
