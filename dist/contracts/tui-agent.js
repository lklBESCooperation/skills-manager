"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TUI_AGENTS = void 0;
exports.isTuiAgent = isTuiAgent;
// TuiAgent extracted from src/shared/tui-agent.ts (upstream-shared); re-sync when agents change.
exports.TUI_AGENTS = [
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
];
const TUI_AGENT_SET = new Set(exports.TUI_AGENTS);
function isTuiAgent(value) {
    return TUI_AGENT_SET.has(value);
}
