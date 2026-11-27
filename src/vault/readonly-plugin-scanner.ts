import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type {
  PluginSkillActivationState,
  PluginSkillRecord,
  PluginSkillScope,
  PluginSkillSourceCategory
} from '../contracts/plugin-skill-contract'
import { summarizeSkillMarkdown } from '../contracts/skill-metadata'
import type { TuiAgent } from '../contracts/tui-agent'

const MAX_WALK_DEPTH = 5
const MAX_SKILL_FILE_BYTES = 256 * 1024
const SKIP_DIR_NAMES = new Set(['.git', 'node_modules'])

export type ReadonlyPluginScanInput = {
  homeDirectory: string
  workspaceDirectory?: string
  /** Optional plugin root directory (e.g. from Orca worker) to probe sibling Orca plugins. */
  pluginRoot?: string
  /** Extra system roots (used mainly in tests to avoid reading `/etc/codex/skills`). */
  etcCodexSkillsRoot?: string
}

export type ReadonlyPluginScanResult = {
  skills: PluginSkillRecord[]
  readonlyRoots: string[]
}

function isWslUncPath(targetPath: string): boolean {
  if (process.platform !== 'win32') {
    return false
  }
  return /^\\\\(?:wsl\$|wsl\.localhost)\\/i.test(targetPath)
}

async function readBoundedUtf8(filePath: string, maxBytes = MAX_SKILL_FILE_BYTES): Promise<string | null> {
  if (isWslUncPath(filePath)) {
    return null
  }
  const info = await stat(filePath).catch(() => null)
  if (!info || !info.isFile() || info.size > maxBytes) {
    return null
  }
  return readFile(filePath, 'utf8').catch(() => null)
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown> | null> {
  const raw = await readBoundedUtf8(filePath)
  if (!raw) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

async function listDirectSubdirectories(root: string): Promise<string[]> {
  if (isWslUncPath(root)) {
    return []
  }
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const dirs: string[] = []
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) {
      continue
    }
    const full = join(root, entry.name)
    if (isWslUncPath(full)) {
      continue
    }
    const isDir =
      entry.isDirectory() ||
      (entry.isSymbolicLink() && ((await stat(full).catch(() => null))?.isDirectory() ?? false))
    if (isDir) {
      dirs.push(full)
    }
  }
  return dirs.sort()
}

type DiscoveredManifest = {
  installPath: string
  pluginId: string
  pluginName: string
  marketplace?: string
}

async function readPluginManifest(
  dirPath: string,
  kind: 'claude' | 'codex' | 'orca'
): Promise<DiscoveredManifest | null> {
  const candidateFiles =
    kind === 'claude'
      ? [join(dirPath, '.claude-plugin', 'plugin.json'), join(dirPath, 'plugin.json')]
      : kind === 'codex'
        ? [join(dirPath, '.codex-plugin', 'plugin.json'), join(dirPath, 'plugin.json')]
        : [join(dirPath, 'orca-plugin.json')]

  for (const manifestPath of candidateFiles) {
    const json = await readJsonRecord(manifestPath)
    if (!json) {
      continue
    }
    const rawId = typeof json.id === 'string' && json.id.trim() ? json.id.trim() : undefined
    const rawName = typeof json.name === 'string' && json.name.trim() ? json.name.trim() : undefined
    const pluginName = rawName ?? rawId ?? basename(dirPath)
    const pluginId = rawId ?? pluginName
    const marketplace =
      typeof json.marketplace === 'string' && json.marketplace.trim()
        ? json.marketplace.trim()
        : undefined
    return {
      installPath: dirPath,
      pluginId,
      pluginName,
      ...(marketplace ? { marketplace } : {})
    }
  }
  return null
}

async function walkForPluginDirs(
  root: string,
  kind: 'claude' | 'codex',
  depth = 0,
  results: DiscoveredManifest[] = []
): Promise<DiscoveredManifest[]> {
  if (depth > MAX_WALK_DEPTH || isWslUncPath(root)) {
    return results
  }
  const manifest = await readPluginManifest(root, kind)
  if (manifest) {
    results.push(manifest)
    return results
  }
  if (depth === MAX_WALK_DEPTH) {
    return results
  }
  const subdirs = await listDirectSubdirectories(root)
  for (const subdir of subdirs) {
    if (basename(subdir).startsWith('.')) {
      continue
    }
    await walkForPluginDirs(subdir, kind, depth + 1, results)
  }
  return results
}

async function collectSkillsUnderDirectory(input: {
  skillsRoot: string
  agent: TuiAgent
  sourceCategory: PluginSkillSourceCategory
  scope: PluginSkillScope
  pluginId: string
  pluginName: string
  marketplace?: string
  installPath: string
  activationState: PluginSkillActivationState
  withInvocationCommand: boolean
  seenRealFiles: Set<string>
  records: PluginSkillRecord[]
}): Promise<void> {
  const skillDirs = await listDirectSubdirectories(input.skillsRoot)
  for (const skillDir of skillDirs) {
    const id = basename(skillDir)
    if (id.startsWith('.')) {
      continue
    }
    const skillFilePath = join(skillDir, 'SKILL.md')
    const markdown = await readBoundedUtf8(skillFilePath)
    if (markdown === null) {
      continue
    }
    const realSkillFile = await realpath(skillFilePath).catch(() => skillFilePath)
    if (input.seenRealFiles.has(realSkillFile)) {
      continue
    }
    input.seenRealFiles.add(realSkillFile)

    const summary = summarizeSkillMarkdown(markdown)
    const fileStat = await stat(skillFilePath).catch(() => null)
    input.records.push({
      id,
      name: summary.name ?? id,
      description: summary.description,
      readonly: true,
      sourceCategory: input.sourceCategory,
      pluginId: input.pluginId,
      pluginName: input.pluginName,
      ...(input.marketplace ? { marketplace: input.marketplace } : {}),
      agent: input.agent,
      scope: input.scope,
      installPath: input.installPath,
      skillDirectoryPath: skillDir,
      skillFilePath,
      ...(input.withInvocationCommand
        ? { invocationCommand: `/${input.pluginName}:${id}` }
        : {}),
      activationState: input.activationState,
      ...(fileStat ? { updatedAt: Math.trunc(fileStat.mtimeMs) } : {})
    })
  }
}

async function readClaudeEnabledPlugins(
  homeDirectory: string,
  workspaceDirectory?: string
): Promise<Map<string, boolean>> {
  const enabled = new Map<string, boolean>()
  const settingsPaths = [
    join(homeDirectory, '.claude', 'settings.json'),
    ...(workspaceDirectory
      ? [
          join(workspaceDirectory, '.claude', 'settings.json'),
          join(workspaceDirectory, '.claude', 'settings.local.json')
        ]
      : [])
  ]
  for (const path of settingsPaths) {
    const json = await readJsonRecord(path)
    const map = json?.enabledPlugins
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      for (const [key, val] of Object.entries(map)) {
        if (typeof val === 'boolean') {
          enabled.set(key, val)
        }
      }
    }
  }
  return enabled
}

function resolveClaudePluginActivation(
  pluginKey: string,
  enabledMap: Map<string, boolean>,
  scope: PluginSkillScope,
  projectPath: string | undefined,
  workspaceDirectory: string | undefined
): PluginSkillActivationState {
  if (
    (scope === 'project' || scope === 'local') &&
    projectPath &&
    workspaceDirectory &&
    projectPath !== workspaceDirectory
  ) {
    return 'project-scoped-inactive'
  }
  const flag = enabledMap.get(pluginKey)
  if (flag === false) {
    return 'disabled-in-settings'
  }
  return 'active'
}

export async function scanReadonlyPluginSkills(
  input: ReadonlyPluginScanInput
): Promise<ReadonlyPluginScanResult> {
  const records: PluginSkillRecord[] = []
  const readonlyRoots = new Set<string>()
  const seenRealFiles = new Set<string>()

  const claudeEnabled = await readClaudeEnabledPlugins(
    input.homeDirectory,
    input.workspaceDirectory
  )

  // 1. Claude installed_plugins.json (if present) + fallback directory walk
  const installedPluginsPath = join(input.homeDirectory, '.claude', 'plugins', 'installed_plugins.json')
  const installedJson = await readJsonRecord(installedPluginsPath)
  const pluginsField = installedJson?.plugins
  if (pluginsField && typeof pluginsField === 'object' && !Array.isArray(pluginsField)) {
    for (const [fullKey, entries] of Object.entries(pluginsField)) {
      if (!Array.isArray(entries)) {
        continue
      }
      const [pluginSlug, marketplace] = fullKey.split('@')
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') {
          continue
        }
        const record = entry as Record<string, unknown>
        const installPath = typeof record.installPath === 'string' ? record.installPath : null
        if (!installPath || isWslUncPath(installPath)) {
          continue
        }
        const scopeRaw = record.scope
        const scope: PluginSkillScope =
          scopeRaw === 'project' || scopeRaw === 'local' ? scopeRaw : 'user'
        const projectPath =
          typeof record.projectPath === 'string' ? record.projectPath : undefined
        const manifest = await readPluginManifest(installPath, 'claude')
        const pluginName = manifest?.pluginName ?? pluginSlug ?? basename(installPath)
        const pluginId = manifest?.pluginId ?? fullKey
        readonlyRoots.add(installPath)
        await collectSkillsUnderDirectory({
          skillsRoot: join(installPath, 'skills'),
          agent: 'claude',
          sourceCategory: 'plugin',
          scope,
          pluginId,
          pluginName,
          ...(marketplace ? { marketplace } : {}),
          installPath,
          activationState: resolveClaudePluginActivation(
            fullKey,
            claudeEnabled,
            scope,
            projectPath,
            input.workspaceDirectory
          ),
          withInvocationCommand: true,
          seenRealFiles,
          records
        })
      }
    }
  }

  const claudePluginRoots: { root: string; scope: PluginSkillScope }[] = [
    { root: join(input.homeDirectory, '.claude', 'plugins'), scope: 'user' },
    ...(input.workspaceDirectory
      ? [{ root: join(input.workspaceDirectory, '.claude', 'plugins'), scope: 'project' as const }]
      : [])
  ]
  for (const { root, scope } of claudePluginRoots) {
    readonlyRoots.add(root)
    const manifests = await walkForPluginDirs(root, 'claude')
    for (const manifest of manifests) {
      readonlyRoots.add(manifest.installPath)
      const flag = claudeEnabled.get(manifest.pluginId)
      await collectSkillsUnderDirectory({
        skillsRoot: join(manifest.installPath, 'skills'),
        agent: 'claude',
        sourceCategory: 'plugin',
        scope,
        pluginId: manifest.pluginId,
        pluginName: manifest.pluginName,
        ...(manifest.marketplace ? { marketplace: manifest.marketplace } : {}),
        installPath: manifest.installPath,
        activationState: flag === false ? 'disabled-in-settings' : 'active',
        withInvocationCommand: true,
        seenRealFiles,
        records
      })
    }
  }

  // 2. Codex plugins & built-in system skills
  const codexPluginsRoot = join(input.homeDirectory, '.codex', 'plugins')
  readonlyRoots.add(codexPluginsRoot)
  const codexManifests = await walkForPluginDirs(codexPluginsRoot, 'codex')
  for (const manifest of codexManifests) {
    readonlyRoots.add(manifest.installPath)
    await collectSkillsUnderDirectory({
      skillsRoot: join(manifest.installPath, 'skills'),
      agent: 'codex',
      sourceCategory: 'plugin',
      scope: 'user',
      pluginId: manifest.pluginId,
      pluginName: manifest.pluginName,
      ...(manifest.marketplace ? { marketplace: manifest.marketplace } : {}),
      installPath: manifest.installPath,
      activationState: 'active',
      withInvocationCommand: true,
      seenRealFiles,
      records
    })
  }

  const codexSystemRoot = join(input.homeDirectory, '.codex', 'skills', '.system')
  readonlyRoots.add(codexSystemRoot)
  await collectSkillsUnderDirectory({
    skillsRoot: codexSystemRoot,
    agent: 'codex',
    sourceCategory: 'bundled-readonly',
    scope: 'user',
    pluginId: 'codex-system',
    pluginName: 'Codex System',
    installPath: codexSystemRoot,
    activationState: 'active',
    withInvocationCommand: false,
    seenRealFiles,
    records
  })

  const etcCodexRoot = input.etcCodexSkillsRoot ?? '/etc/codex/skills'
  if (etcCodexRoot) {
    readonlyRoots.add(etcCodexRoot)
    await collectSkillsUnderDirectory({
      skillsRoot: etcCodexRoot,
      agent: 'codex',
      sourceCategory: 'bundled-readonly',
      scope: 'user',
      pluginId: 'codex-etc',
      pluginName: 'Codex System (/etc)',
      installPath: etcCodexRoot,
      activationState: 'active',
      withInvocationCommand: false,
      seenRealFiles,
      records
    })
  }

  // 3. Cursor built-in readonly skills
  const cursorRoot = join(input.homeDirectory, '.cursor', 'skills-cursor')
  readonlyRoots.add(cursorRoot)
  await collectSkillsUnderDirectory({
    skillsRoot: cursorRoot,
    agent: 'cursor',
    sourceCategory: 'bundled-readonly',
    scope: 'user',
    pluginId: 'cursor-builtin',
    pluginName: 'Cursor Built-in',
    installPath: cursorRoot,
    activationState: 'active',
    withInvocationCommand: false,
    seenRealFiles,
    records
  })

  // 4. Sibling Orca plugins (when pluginRoot is known)
  if (input.pluginRoot && !isWslUncPath(input.pluginRoot)) {
    const pluginsParent = dirname(input.pluginRoot)
    const siblingDirs = await listDirectSubdirectories(pluginsParent)
    for (const siblingDir of siblingDirs) {
      const manifest = await readPluginManifest(siblingDir, 'orca')
      if (!manifest) {
        continue
      }
      readonlyRoots.add(siblingDir)
      await collectSkillsUnderDirectory({
        skillsRoot: join(siblingDir, 'skills'),
        agent: 'claude',
        sourceCategory: 'bundled-readonly',
        scope: 'user',
        pluginId: manifest.pluginId,
        pluginName: manifest.pluginName,
        marketplace: 'orca-plugin',
        installPath: siblingDir,
        activationState: 'active',
        withInvocationCommand: false,
        seenRealFiles,
        records
      })
    }
  }

  records.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return {
    skills: records,
    readonlyRoots: [...readonlyRoots]
  }
}
