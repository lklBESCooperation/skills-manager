import { describe, expect, it } from 'vitest'
import { fixtureSalvage } from '../enablement/skill-enablement-file-io.test-fixture'
import {
  parseSkillProjectStateFile,
  parseSkillUserDefaultsFile,
  resolveEffectiveSkills,
  skillProjectStateFileValue,
  skillUserDefaultsFileValue,
  SKILL_ENABLEMENT_SCHEMA_VERSION
} from './skill-enablement'

function resolution(
  installed: readonly string[],
  userDefaults: Record<string, 'enabled' | 'disabled' | undefined>,
  projectOverrides: Record<string, 'inherit' | 'enabled' | 'disabled' | undefined>
): Record<string, { effective: string; origin: string }> {
  return Object.fromEntries(resolveEffectiveSkills({ installed, userDefaults, projectOverrides }))
}

describe('resolveEffectiveSkills (tri-state resolution)', () => {
  // T2.1 no configuration at all -> everything enabled, origin user (install-is-enabled default)
  it('T2.1: defaults every installed skill to enabled with origin user', () => {
    expect(resolution(['alpha', 'beta'], {}, {})).toEqual({
      alpha: { effective: 'enabled', origin: 'user' },
      beta: { effective: 'enabled', origin: 'user' }
    })
  })

  // T2.2 user default disabled + no project override -> disabled, origin user
  it('T2.2: user default disabled with no project override stays disabled', () => {
    expect(resolution(['alpha'], { alpha: 'disabled' }, {})).toEqual({
      alpha: { effective: 'disabled', origin: 'user' }
    })
  })

  // T2.3 user disabled + project enabled -> enabled, origin project
  it('T2.3: project enabled beats user disabled', () => {
    expect(resolution(['alpha'], { alpha: 'disabled' }, { alpha: 'enabled' })).toEqual({
      alpha: { effective: 'enabled', origin: 'project' }
    })
  })

  // T2.4 explicit project 'inherit' falls back to the user default
  it('T2.4: explicit inherit key falls back to the user default', () => {
    expect(resolution(['alpha'], { alpha: 'disabled' }, { alpha: 'inherit' })).toEqual({
      alpha: { effective: 'disabled', origin: 'user' }
    })
    expect(resolution(['beta'], {}, { beta: 'inherit' })).toEqual({
      beta: { effective: 'enabled', origin: 'user' }
    })
  })

  // T2.5 overrides never mint resolutions for skills that are not installed
  it('T2.5: uninstalled ids never resolve, whatever the overrides say', () => {
    const resolved = resolveEffectiveSkills({
      installed: ['alpha'],
      userDefaults: { alpha: 'enabled', phantom: 'disabled' },
      projectOverrides: { phantom: 'enabled' }
    })
    expect(resolved.has('phantom')).toBe(false)
    expect(Object.fromEntries(resolved)).toEqual({
      alpha: { effective: 'enabled', origin: 'user' }
    })
  })

  // T2.6 corrupt state keys salvage away; the rest of the file still applies
  it('T2.6: salvage-drops bad keys in a parsed state file and keeps good ones', () => {
    const userFile = JSON.stringify({
      schemaVersion: SKILL_ENABLEMENT_SCHEMA_VERSION,
      defaults: { alpha: 'disabled', broken: 'sometimes', gamma: 'enabled' }
    })
    const userSalvage = parseSkillUserDefaultsFile(userFile, fixtureSalvage)
    expect(userSalvage.unreadable).toBe(false)
    expect(userSalvage.value).toEqual({ alpha: 'disabled', gamma: 'enabled' })
    expect(userSalvage.droppedKeys).toEqual(['broken'])

    const projectFile = JSON.stringify({
      schemaVersion: SKILL_ENABLEMENT_SCHEMA_VERSION,
      overrides: { alpha: 'enabled', broken: 42 }
    })
    const projectSalvage = parseSkillProjectStateFile(projectFile, fixtureSalvage)
    expect(projectSalvage.value).toEqual({ alpha: 'enabled' })
    expect(projectSalvage.droppedKeys).toEqual(['broken'])
  })

  it('T2.6b: unreadable JSON degrades to empty, not an error', () => {
    const unreadable = parseSkillUserDefaultsFile('{not json', fixtureSalvage)
    expect(unreadable.value).toEqual({})
    expect(unreadable.unreadable).toBe(true)
    const missing = parseSkillUserDefaultsFile(null, fixtureSalvage)
    expect(missing.value).toEqual({})
    expect(missing.unreadable).toBe(false)
    expect(parseSkillProjectStateFile(null, fixtureSalvage).value).toEqual({})
  })

  it('T2.6c: wrong schemaVersion reads as absent rather than fatal', () => {
    const future = JSON.stringify({
      schemaVersion: 99,
      defaults: { alpha: 'disabled' }
    })
    const salvage = parseSkillUserDefaultsFile(future, fixtureSalvage)
    expect(salvage.value).toEqual({})
    expect(salvage.unreadable).toBe(true)
  })

  it('project disabled beats user enabled; every installed id gets a resolution', () => {
    expect(resolution(['a', 'b', 'c'], { a: 'enabled' }, { b: 'disabled' })).toEqual({
      a: { effective: 'enabled', origin: 'user' },
      b: { effective: 'disabled', origin: 'project' },
      c: { effective: 'enabled', origin: 'user' }
    })
  })

  it('serializes both state files with a stable sorted key order', () => {
    expect(skillUserDefaultsFileValue({ zeta: 'enabled', alpha: 'disabled' })).toEqual({
      schemaVersion: SKILL_ENABLEMENT_SCHEMA_VERSION,
      defaults: { alpha: 'disabled', zeta: 'enabled' }
    })
    expect(
      skillProjectStateFileValue({
        zeta: 'inherit',
        alpha: 'enabled',
        mid: 'disabled'
      })
    ).toEqual({
      schemaVersion: SKILL_ENABLEMENT_SCHEMA_VERSION,
      overrides: { alpha: 'enabled', mid: 'disabled', zeta: 'inherit' }
    })
  })

  it('a __proto__ key never lands in serialized output', () => {
    const overrides: Record<string, 'enabled'> = JSON.parse(
      '{"__proto__": "enabled", "alpha": "enabled"}'
    )
    expect(Object.keys(skillProjectStateFileValue(overrides).overrides)).toEqual(['alpha'])
  })
})
