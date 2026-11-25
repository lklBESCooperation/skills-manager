import { TUI_AGENTS, type TuiAgent } from './tui-agent'

export type AgentSkillCapability =
  | 'managed'
  | 'discovery-only'
  | 'delegate'
  | 'unsupported'

export type AgentSkillDescriptor = {
  readonly id: TuiAgent
  readonly displayName: string
  readonly capability: AgentSkillCapability
  readonly delegatesTo?: TuiAgent
  /** Whether the agent reads `.agents/skills` under each scope. */
  readonly readsCanonical: {
    readonly global: boolean
    readonly workspace: boolean
  }
  /** Single-source write/link target segments; null means canonical `.agents/skills`. */
  readonly installTargets: {
    readonly globalSegments: readonly string[] | null
    readonly workspaceSegments: readonly string[] | null
    /** Env var relocating the agent's home for installation (`<home>/skills`). */
    readonly homeEnv?: string
  }
  /** Extra roots scanned for discovery & Adopt only (never written on install/enable). */
  readonly discoveryOnlyRoots?: {
    readonly globalSegments?: readonly (readonly string[])[]
    readonly workspaceSegments?: readonly (readonly string[])[]
    readonly customHomeResolver?: 'hermes-platform-home'
    readonly acpHomeEnv?: string
  }
  /** Former install roots now retired and cleaned up when migrating to canonical. */
  readonly retiredInstallRoots?: readonly (readonly string[])[]
  /** Cross-agent skill folder borrowing (read-only visibility derivation). */
  readonly borrowedOwners?: {
    readonly global?: readonly TuiAgent[]
    readonly workspace?: readonly TuiAgent[]
  }
  /** Built-in readonly directories shipped by the agent itself. */
  readonly bundledReadonlySegments?: readonly (readonly string[])[]
}

const CANONICAL_DEFAULT = { global: true, workspace: true } as const
const NO_PRIVATE_TARGET = { globalSegments: null, workspaceSegments: null } as const

function canonicalManaged(
  id: TuiAgent,
  displayName: string,
  extra?: Partial<Omit<AgentSkillDescriptor, 'id' | 'displayName' | 'capability' | 'readsCanonical' | 'installTargets'>>
): AgentSkillDescriptor {
  return {
    id,
    displayName,
    capability: 'managed',
    readsCanonical: CANONICAL_DEFAULT,
    installTargets: NO_PRIVATE_TARGET,
    ...extra
  }
}

/**
 * Compile-time single source of truth covering all 45 TuiAgent entries.
 * `SKILL_INSTALL_PROVIDERS` and discovery/borrowing helpers derive from this table.
 */
export const AGENT_SKILL_REGISTRY = {
  codex: canonicalManaged('codex', 'Codex', {
    discoveryOnlyRoots: {
      globalSegments: [['.codex', 'skills']],
      workspaceSegments: [['.codex', 'skills']],
      acpHomeEnv: 'CODEX_HOME'
    },
    bundledReadonlySegments: [['.codex', 'skills', '.system']]
  }),
  claude: {
    id: 'claude',
    displayName: 'Claude Code',
    capability: 'managed',
    readsCanonical: { global: false, workspace: false },
    installTargets: {
      globalSegments: ['.claude', 'skills'],
      workspaceSegments: ['.claude', 'skills'],
      homeEnv: 'CLAUDE_CONFIG_DIR'
    }
  },
  'claude-agent-teams': {
    id: 'claude-agent-teams',
    displayName: 'Claude Agent Teams',
    capability: 'delegate',
    delegatesTo: 'claude',
    readsCanonical: { global: false, workspace: false },
    installTargets: NO_PRIVATE_TARGET
  },
  cursor: {
    id: 'cursor',
    displayName: 'Cursor',
    capability: 'managed',
    readsCanonical: CANONICAL_DEFAULT,
    installTargets: {
      globalSegments: ['.cursor', 'skills'],
      workspaceSegments: null
    },
    discoveryOnlyRoots: {
      workspaceSegments: [['.cursor', 'skills']],
      acpHomeEnv: 'CURSOR_CONFIG_DIR'
    },
    borrowedOwners: {
      global: ['claude', 'codex', 'grok'],
      workspace: ['claude', 'codex', 'grok']
    },
    bundledReadonlySegments: [['.cursor', 'skills-cursor']]
  },
  gemini: canonicalManaged('gemini', 'Gemini CLI', {
    discoveryOnlyRoots: {
      globalSegments: [['.gemini', 'skills']],
      acpHomeEnv: 'GEMINI_CLI_HOME'
    },
    retiredInstallRoots: [['.gemini', 'skills']]
  }),
  droid: {
    id: 'droid',
    displayName: 'Droid',
    capability: 'managed',
    readsCanonical: CANONICAL_DEFAULT,
    installTargets: {
      globalSegments: ['.factory', 'skills'],
      workspaceSegments: ['.factory', 'skills']
    },
    discoveryOnlyRoots: {
      acpHomeEnv: 'FACTORY_HOME_OVERRIDE'
    }
  },
  continue: {
    id: 'continue',
    displayName: 'Continue',
    capability: 'managed',
    readsCanonical: CANONICAL_DEFAULT,
    installTargets: {
      globalSegments: ['.continue', 'skills'],
      workspaceSegments: ['.continue', 'skills']
    }
  },
  trae: {
    id: 'trae',
    displayName: 'Trae',
    capability: 'managed',
    readsCanonical: CANONICAL_DEFAULT,
    installTargets: {
      globalSegments: ['.trae-cn', 'skills'],
      workspaceSegments: ['.trae', 'skills']
    }
  },
  grok: {
    id: 'grok',
    displayName: 'Grok',
    capability: 'managed',
    readsCanonical: CANONICAL_DEFAULT,
    installTargets: {
      globalSegments: ['.grok', 'skills'],
      workspaceSegments: ['.grok', 'skills'],
      homeEnv: 'GROK_HOME'
    }
  },
  aug: {
    id: 'aug',
    displayName: 'Augment',
    capability: 'managed',
    readsCanonical: CANONICAL_DEFAULT,
    installTargets: {
      globalSegments: ['.augment', 'skills'],
      workspaceSegments: ['.augment', 'skills']
    },
    discoveryOnlyRoots: {
      acpHomeEnv: 'AUGMENT_CACHE_DIR'
    },
    borrowedOwners: {
      global: ['claude'],
      workspace: ['claude']
    }
  },
  muse: canonicalManaged('muse', 'Muse', {
    discoveryOnlyRoots: {
      globalSegments: [['.config', 'muse', 'skills']]
    }
  }),
  zcode: {
    id: 'zcode',
    displayName: 'ZCode',
    capability: 'managed',
    readsCanonical: CANONICAL_DEFAULT,
    installTargets: {
      globalSegments: ['.zcode', 'skills'],
      workspaceSegments: null
    }
  },
  codebuddy: {
    id: 'codebuddy',
    displayName: 'CodeBuddy',
    capability: 'managed',
    readsCanonical: CANONICAL_DEFAULT,
    installTargets: {
      globalSegments: ['.codebuddy', 'skills'],
      workspaceSegments: ['.codebuddy', 'skills']
    },
    discoveryOnlyRoots: {
      acpHomeEnv: 'CODEBUDDY_CONFIG_DIR'
    }
  },
  kiro: {
    id: 'kiro',
    displayName: 'Kiro',
    capability: 'managed',
    readsCanonical: CANONICAL_DEFAULT,
    installTargets: {
      globalSegments: ['.kiro', 'skills'],
      workspaceSegments: ['.kiro', 'skills'],
      homeEnv: 'KIRO_HOME'
    }
  },
  antigravity: {
    id: 'antigravity',
    displayName: 'Antigravity',
    capability: 'managed',
    readsCanonical: CANONICAL_DEFAULT,
    installTargets: {
      globalSegments: ['.gemini', 'config', 'skills'],
      workspaceSegments: null
    },
    discoveryOnlyRoots: {
      globalSegments: [['.gemini', 'antigravity-cli', 'skills']],
      acpHomeEnv: 'GEMINI_HOME'
    }
  },
  openclaude: {
    id: 'openclaude',
    displayName: 'OpenClaude',
    capability: 'managed',
    readsCanonical: CANONICAL_DEFAULT,
    installTargets: {
      globalSegments: ['.openclaude', 'skills'],
      workspaceSegments: ['.openclaude', 'skills'],
      homeEnv: 'OPENCLAUDE_CONFIG_DIR'
    },
    borrowedOwners: {
      global: ['claude'],
      workspace: ['claude']
    }
  },
  autohand: canonicalManaged('autohand', 'Autohand Code'),
  goose: canonicalManaged('goose', 'Goose'),
  crush: canonicalManaged('crush', 'Crush'),
  'command-code': canonicalManaged('command-code', 'Command Code'),
  'mistral-vibe': canonicalManaged('mistral-vibe', 'Mistral Vibe'),
  'qwen-code': canonicalManaged('qwen-code', 'Qwen Code', {
    discoveryOnlyRoots: { acpHomeEnv: 'QWEN_HOME' }
  }),
  rovo: canonicalManaged('rovo', 'Rovo Dev'),
  openclaw: canonicalManaged('openclaw', 'OpenClaw'),
  devin: canonicalManaged('devin', 'Devin'),
  opencode: canonicalManaged('opencode', 'OpenCode', {
    discoveryOnlyRoots: {
      globalSegments: [['.config', 'opencode', 'skills']],
      workspaceSegments: [['.opencode', 'skills']]
    },
    borrowedOwners: {
      global: ['claude'],
      workspace: ['claude']
    }
  }),
  pi: canonicalManaged('pi', 'Pi', {
    discoveryOnlyRoots: {
      globalSegments: [['.pi', 'agent', 'skills']]
    }
  }),
  amp: canonicalManaged('amp', 'Amp'),
  kilo: canonicalManaged('kilo', 'Kilo Code'),
  cline: canonicalManaged('cline', 'Cline', {
    discoveryOnlyRoots: { acpHomeEnv: 'CLINE_DIR' }
  }),
  kimi: canonicalManaged('kimi', 'Kimi', {
    discoveryOnlyRoots: { acpHomeEnv: 'KIMI_CODE_HOME' }
  }),
  copilot: canonicalManaged('copilot', 'GitHub Copilot', {
    discoveryOnlyRoots: {
      globalSegments: [['.copilot', 'skills']],
      workspaceSegments: [['.github', 'skills']],
      acpHomeEnv: 'COPILOT_HOME'
    },
    borrowedOwners: {
      workspace: ['claude']
    }
  }),
  opencode2: canonicalManaged('opencode2', 'OpenCode 2', {
    discoveryOnlyRoots: {
      globalSegments: [['.config', 'opencode', 'skills']],
      workspaceSegments: [['.opencode', 'skills']]
    },
    borrowedOwners: {
      global: ['claude'],
      workspace: ['claude']
    }
  }),
  'mimo-code': canonicalManaged('mimo-code', 'MiMo Code', {
    discoveryOnlyRoots: { acpHomeEnv: 'MIMOCODE_CONFIG_DIR' }
  }),
  omp: canonicalManaged('omp', 'OMP', {
    discoveryOnlyRoots: {
      globalSegments: [['.omp', 'agent', 'skills']],
      acpHomeEnv: 'PI_CODING_AGENT_DIR'
    }
  }),
  'prime-agent': canonicalManaged('prime-agent', 'Prime Agent', {
    discoveryOnlyRoots: {
      globalSegments: [['.prime', 'agent', 'skills']],
      workspaceSegments: [['.prime', 'agent', 'skills']]
    }
  }),
  qoder: canonicalManaged('qoder', 'Qoder', {
    discoveryOnlyRoots: {
      globalSegments: [['.qoder', 'skills']],
      workspaceSegments: [['.qoder', 'skills']]
    }
  }),
  'qoder-cn': canonicalManaged('qoder-cn', 'Qoder CN', {
    discoveryOnlyRoots: {
      globalSegments: [['.qoder-cn', 'skills']],
      workspaceSegments: [['.qoder-cn', 'skills']]
    }
  }),
  codebuff: canonicalManaged('codebuff', 'Codebuff'),
  freebuff: canonicalManaged('freebuff', 'Freebuff'),
  ante: canonicalManaged('ante', 'Ante'),
  jcode: canonicalManaged('jcode', 'Jcode'),
  dsh: canonicalManaged('dsh', 'DeepSeek Harness', {
    discoveryOnlyRoots: { acpHomeEnv: 'DSH_HOME' }
  }),
  hermes: {
    id: 'hermes',
    displayName: 'Hermes Agent',
    capability: 'discovery-only',
    readsCanonical: { global: false, workspace: false },
    installTargets: NO_PRIVATE_TARGET,
    discoveryOnlyRoots: {
      globalSegments: [['.hermes', 'skills']],
      customHomeResolver: 'hermes-platform-home',
      acpHomeEnv: 'HERMES_HOME'
    }
  },
  aider: {
    id: 'aider',
    displayName: 'Aider',
    capability: 'unsupported',
    readsCanonical: { global: false, workspace: false },
    installTargets: NO_PRIVATE_TARGET
  }
} as const satisfies Readonly<Record<TuiAgent, AgentSkillDescriptor>>

export const AGENT_SKILL_DESCRIPTORS: readonly AgentSkillDescriptor[] = TUI_AGENTS.map(
  (agent) => AGENT_SKILL_REGISTRY[agent]
)

export function getAgentSkillDescriptor(agent: TuiAgent): AgentSkillDescriptor {
  return AGENT_SKILL_REGISTRY[agent]
}

export function getAgentBorrowedOwners(
  agent: TuiAgent,
  scope: 'global' | 'workspace'
): readonly TuiAgent[] {
  const descriptor: AgentSkillDescriptor = AGENT_SKILL_REGISTRY[agent]
  const resolved: AgentSkillDescriptor =
    descriptor.capability === 'delegate' && descriptor.delegatesTo
      ? AGENT_SKILL_REGISTRY[descriptor.delegatesTo]
      : descriptor
  return (scope === 'global' ? resolved.borrowedOwners?.global : resolved.borrowedOwners?.workspace) ?? []
}

export function getAgentDiscoverySegments(
  agent: TuiAgent,
  scope: 'global' | 'workspace'
): readonly (readonly string[])[] {
  const descriptor: AgentSkillDescriptor = AGENT_SKILL_REGISTRY[agent]
  const target =
    scope === 'global'
      ? descriptor.installTargets.globalSegments
      : descriptor.installTargets.workspaceSegments
  const extra =
    scope === 'global'
      ? descriptor.discoveryOnlyRoots?.globalSegments
      : descriptor.discoveryOnlyRoots?.workspaceSegments
  const segments: (readonly string[])[] = []
  if (target) {
    segments.push(target)
  }
  if (extra) {
    for (const entry of extra) {
      const key = entry.join('/')
      if (!segments.some((existing) => existing.join('/') === key)) {
        segments.push(entry)
      }
    }
  }
  return segments
}
