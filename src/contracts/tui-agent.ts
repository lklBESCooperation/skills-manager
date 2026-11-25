// TuiAgent extracted from src/shared/tui-agent.ts (upstream-shared); re-sync when agents change.
export const TUI_AGENTS = [
  'claude',
  'claude-agent-teams',
  'codebuddy',
  'openclaude',
  'codex',
  'autohand',
  'opencode',
  'opencode2',
  'mimo-code',
  'pi',
  'omp',
  'qoder',
  'qoder-cn',
  'gemini',
  'antigravity',
  'aider',
  'goose',
  'amp',
  'kilo',
  'kiro',
  'crush',
  'aug',
  'cline',
  'codebuff',
  'freebuff',
  'command-code',
  'continue',
  'cursor',
  'droid',
  'kimi',
  'mistral-vibe',
  'qwen-code',
  'rovo',
  'hermes',
  'openclaw',
  'copilot',
  'grok',
  'devin',
  'ante',
  'trae',
  'muse',
  'zcode',
  'prime-agent',
  'dsh',
  'jcode'
] as const

export type TuiAgent = (typeof TUI_AGENTS)[number]

const TUI_AGENT_SET: ReadonlySet<string> = new Set(TUI_AGENTS)

export function isTuiAgent(value: string): value is TuiAgent {
  return TUI_AGENT_SET.has(value)
}
