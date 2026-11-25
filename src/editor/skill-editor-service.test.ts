import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createLocalSkillInVault,
  deleteSkillFile,
  listSkillFiles,
  readSkillFile,
  writeSkillFile
} from './skill-editor-service'
import { readSkillVaultIndex } from '../vault/skill-vault-index-service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('SkillEditorService (containment, frontmatter validation & wizard)', () => {
  it('creates, lists, reads, edits, and deletes skill files while keeping Vault index synced', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-editor-'))
    roots.push(root)
    const scope = {
      vaultRoot: join(root, '.pmstudio', 'skills'),
      indexPath: join(root, '.pmstudio', 'skills-index.json')
    }

    const created = await createLocalSkillInVault(
      scope,
      {
        id: 'api-review',
        name: 'API Review',
        description: 'Check REST and RPC endpoints.',
        author: 'alice',
        tags: ['backend'],
        instructions: 'Inspect status codes and schemas.'
      },
      [{ relativePath: 'references/checklist.md', content: '# Checklist\n' }]
    )
    expect(created.id).toBe('api-review')

    const files = await listSkillFiles(scope, 'api-review')
    expect(files.map((f) => f.relativePath)).toEqual([
      'SKILL.md',
      'references',
      'references/checklist.md'
    ])

    const content = await readSkillFile(scope, 'api-review', 'SKILL.md')
    expect(content).toContain('name: API Review')

    await writeSkillFile(
      scope,
      'api-review',
      'SKILL.md',
      '---\nname: API Review v2\ndescription: Updated description\n---\nNew body.\n'
    )
    const index = await readSkillVaultIndex(scope.indexPath)
    expect(index?.entries.find((e) => e.id === 'api-review')?.name).toBe('API Review v2')

    await deleteSkillFile(scope, 'api-review', 'references/checklist.md')
    await expect(readSkillFile(scope, 'api-review', 'references/checklist.md')).rejects.toThrow(
      'skill-editor-not-found'
    )
  })

  it('rejects invalid YAML frontmatter and blocks path traversal & symlink escape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-editor-sec-'))
    roots.push(root)
    const scope = {
      vaultRoot: join(root, '.pmstudio', 'skills'),
      indexPath: join(root, '.pmstudio', 'skills-index.json')
    }
    await createLocalSkillInVault(scope, {
      id: 'safe-skill',
      name: 'Safe',
      description: 'Safe skill'
    })

    const secretOutside = join(root, 'secret.txt')
    await writeFile(secretOutside, 'top-secret')
    const escapeLink = join(scope.vaultRoot, 'safe-skill', 'escape-link')
    await symlink(secretOutside, escapeLink, 'file')
    const escapeDir = join(root, 'outside-dir')
    await mkdir(escapeDir, { recursive: true })
    await symlink(escapeDir, join(scope.vaultRoot, 'safe-skill', 'escape-dir'), 'dir')

    // Frontmatter validation
    await expect(
      writeSkillFile(scope, 'safe-skill', 'SKILL.md', '# Missing frontmatter\n')
    ).rejects.toThrow('skill-editor-invalid-frontmatter')

    // Lexical traversal
    await expect(readSkillFile(scope, 'safe-skill', '../secret.txt')).rejects.toThrow(
      'skill-path-escape'
    )
    await expect(writeSkillFile(scope, 'safe-skill', '/etc/passwd', 'nope')).rejects.toThrow(
      'skill-path-escape'
    )
    await expect(readSkillFile(scope, '../outside', 'SKILL.md')).rejects.toThrow(
      'skill-editor-invalid-id'
    )

    // Symlink escape on read and write
    await expect(readSkillFile(scope, 'safe-skill', 'escape-link')).rejects.toThrow(
      'skill-path-escape'
    )
    await expect(
      writeSkillFile(scope, 'safe-skill', 'escape-dir/pwned.txt', 'evil')
    ).rejects.toThrow('skill-path-escape')
    expect(await readFile(secretOutside, 'utf8')).toBe('top-secret')
  })

  it('blocks deleting SKILL.md across normalized relative paths, case variants, and internal symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-editor-del-guard-'))
    roots.push(root)
    const scope = {
      vaultRoot: join(root, '.pmstudio', 'skills'),
      indexPath: join(root, '.pmstudio', 'skills-index.json')
    }
    await createLocalSkillInVault(
      scope,
      {
        id: 'guard-skill',
        name: 'Guard Skill',
        description: 'Protected SKILL.md'
      },
      [{ relativePath: 'references/note.md', content: '# Note\n' }]
    )
    const skillDir = join(scope.vaultRoot, 'guard-skill')

    for (const candidate of [
      'SKILL.md',
      './SKILL.md',
      'references/../SKILL.md',
      'skill.md',
      './Skill.MD',
      'references/../sKiLl.Md'
    ]) {
      await expect(deleteSkillFile(scope, 'guard-skill', candidate)).rejects.toThrow(
        'skill-editor-cannot-delete-skill-md'
      )
    }

    const selfLink = join(skillDir, 'self-link')
    await symlink(skillDir, selfLink, 'dir')
    try {
      for (const candidate of ['self-link/SKILL.md', 'self-link/skill.md']) {
        await expect(deleteSkillFile(scope, 'guard-skill', candidate)).rejects.toThrow(
          'skill-editor-cannot-delete-skill-md'
        )
      }
    } finally {
      await rm(selfLink, { force: true })
    }

    const surviving = await readSkillFile(scope, 'guard-skill', 'SKILL.md')
    expect(surviving).toContain('name: Guard Skill')
  })

  it('enforces frontmatter validation and canonical SKILL.md path across normalized and case-variant writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-editor-write-guard-'))
    roots.push(root)
    const scope = {
      vaultRoot: join(root, '.pmstudio', 'skills'),
      indexPath: join(root, '.pmstudio', 'skills-index.json')
    }
    await createLocalSkillInVault(
      scope,
      {
        id: 'case-skill',
        name: 'Case Skill',
        description: 'Initial description'
      },
      [{ relativePath: 'references/ref.md', content: '# Ref\n' }]
    )
    const skillDir = join(scope.vaultRoot, 'case-skill')

    for (const candidate of [
      './SKILL.md',
      'references/../SKILL.md',
      'skill.md',
      './Skill.MD'
    ]) {
      await expect(
        writeSkillFile(scope, 'case-skill', candidate, '# Missing frontmatter\n')
      ).rejects.toThrow('skill-editor-invalid-frontmatter')
    }

    const selfLink = join(skillDir, 'self-link')
    await symlink(skillDir, selfLink, 'dir')
    try {
      await expect(
        writeSkillFile(scope, 'case-skill', 'self-link/skill.md', '# Missing frontmatter\n')
      ).rejects.toThrow('skill-editor-invalid-frontmatter')
    } finally {
      await rm(selfLink, { force: true })
    }

    await expect(
      createLocalSkillInVault(
        scope,
        {
          id: 'extra-invalid',
          name: 'Extra Invalid',
          description: 'Valid wizard input'
        },
        [{ relativePath: 'skill.md', content: '# Unvalidated overwrite\n' }]
      )
    ).rejects.toThrow('skill-editor-invalid-frontmatter')

    await writeSkillFile(
      scope,
      'case-skill',
      './skill.md',
      '---\nname: Case Skill Updated\ndescription: Updated via lowercase path\n---\nUpdated.\n'
    )

    const files = await listSkillFiles(scope, 'case-skill')
    expect(files.filter((f) => f.relativePath.toLowerCase() === 'skill.md')).toEqual([
      { relativePath: 'SKILL.md', kind: 'file', sizeBytes: expect.any(Number) }
    ])
    expect(await readSkillFile(scope, 'case-skill', 'SKILL.md')).toContain(
      'name: Case Skill Updated'
    )
  })
})
