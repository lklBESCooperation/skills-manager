export type SkillPackMode = 'apply' | 'switch'
export type SkillPackPreview = {
  enable: Set<string>
  disable: Set<string>
  keep: Set<string>
  missing: Set<string>
}

export function previewSkillPack(input: {
  current: ReadonlySet<string>
  members: ReadonlySet<string>
  installed: ReadonlySet<string>
  mode: SkillPackMode
}): SkillPackPreview {
  const missing = new Set([...input.members].filter((id) => !input.installed.has(id)))
  const available = new Set([...input.members].filter((id) => input.installed.has(id)))
  const target = input.mode === 'apply' ? new Set([...input.current, ...available]) : available
  return {
    enable: new Set([...target].filter((id) => !input.current.has(id))),
    disable: new Set([...input.current].filter((id) => !target.has(id))),
    keep: new Set([...input.current].filter((id) => target.has(id))),
    missing
  }
}
