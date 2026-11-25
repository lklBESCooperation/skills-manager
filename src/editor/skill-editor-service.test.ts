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
})
