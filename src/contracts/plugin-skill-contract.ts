import { z } from 'zod'
import {
  nativeSkillPathSemantics,
  normalizedSkillPath,
  skillPathInside,
  skillPathsEqual,
  type SkillPathSemantics
} from './skill-path-containment'
import type { TuiAgent } from './tui-agent'

export const PluginSkillSourceCategorySchema = z.enum(['plugin', 'bundled-readonly'])
export type PluginSkillSourceCategory = z.infer<typeof PluginSkillSourceCategorySchema>

export const PluginSkillActivationStateSchema = z.enum([
  'active',
  'disabled-in-settings',
  'project-scoped-inactive',
  'wsl-unavailable',
  'unknown'
])
export type PluginSkillActivationState = z.infer<typeof PluginSkillActivationStateSchema>

export const PluginSkillScopeSchema = z.enum(['user', 'project', 'local'])
export type PluginSkillScope = z.infer<typeof PluginSkillScopeSchema>

export type PluginSkillRecord = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly readonly: true
  readonly sourceCategory: PluginSkillSourceCategory
  readonly pluginId: string
  readonly pluginName: string
  readonly marketplace?: string
  readonly agent: TuiAgent
  readonly scope: PluginSkillScope
  readonly installPath: string
  readonly skillDirectoryPath: string
  readonly skillFilePath: string
  readonly invocationCommand?: string
  readonly activationState: PluginSkillActivationState
  readonly digest?: string
  readonly updatedAt?: number | null
}

/**
 * Static path marker segments that are ALWAYS readonly plugin/bundled skill domains.
 * Checked lexically (and after realpath) to prevent any write/adopt/enablement/delete/pack mutation.
 */
export const STATIC_READONLY_SKILL_MARKERS: readonly string[] = [
  '/.claude/plugins/',
  '/.codex/plugins/',
  '/.codex/skills/.system/',
  '/etc/codex/skills/',
  '/.tmp/bundled-marketplaces/',
  '/.cursor/skills-cursor/',
  '/native-chat-visuals/',
  '/bot-linked-skills/'
]

export const READONLY_SKILL_ERROR_CODE = 'skill-readonly-plugin-protected' as const

export type ReadonlyRootFenceContext = {
  readonly readonlyRoots?: readonly string[]
  readonly semantics?: SkillPathSemantics
}

function forwardSlashed(path: string, semantics: SkillPathSemantics): string {
  const normalized = normalizedSkillPath(path, semantics).replace(/\\/g, '/')
  return semantics.caseSensitive ? normalized : normalized.toLocaleLowerCase('en-US')
}

export function isStaticReadonlySkillPath(
  targetPath: string,
  semantics: SkillPathSemantics = nativeSkillPathSemantics()
): boolean {
  const slashed = forwardSlashed(targetPath, semantics)
  const withTrailing = slashed.endsWith('/') ? slashed : `${slashed}/`
  return STATIC_READONLY_SKILL_MARKERS.some((marker) => {
    const normalizedMarker = semantics.caseSensitive
      ? marker
      : marker.toLocaleLowerCase('en-US')
    return withTrailing.includes(normalizedMarker)
  })
}

export function isPathInsideReadonlyRoots(
  targetPath: string,
  context: ReadonlyRootFenceContext = {}
): boolean {
  const semantics = context.semantics ?? nativeSkillPathSemantics()
  if (isStaticReadonlySkillPath(targetPath, semantics)) {
    return true
  }
  const roots = context.readonlyRoots ?? []
  return roots.some(
    (root) =>
      skillPathsEqual(root, targetPath, semantics) || skillPathInside(root, targetPath, semantics)
  )
}
