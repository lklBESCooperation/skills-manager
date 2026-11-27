"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanReadonlyPluginSkills = scanReadonlyPluginSkills;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const skill_metadata_1 = require("../contracts/skill-metadata");
const MAX_WALK_DEPTH = 5;
const MAX_SKILL_FILE_BYTES = 256 * 1024;
const SKIP_DIR_NAMES = new Set(['.git', 'node_modules']);
function isWslUncPath(targetPath) {
    if (process.platform !== 'win32') {
        return false;
    }
    return /^\\\\(?:wsl\$|wsl\.localhost)\\/i.test(targetPath);
}
async function readBoundedUtf8(filePath, maxBytes = MAX_SKILL_FILE_BYTES) {
    if (isWslUncPath(filePath)) {
        return null;
    }
    const info = await (0, promises_1.stat)(filePath).catch(() => null);
    if (!info || !info.isFile() || info.size > maxBytes) {
        return null;
    }
    return (0, promises_1.readFile)(filePath, 'utf8').catch(() => null);
}
async function readJsonRecord(filePath) {
    const raw = await readBoundedUtf8(filePath);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
async function listDirectSubdirectories(root) {
    if (isWslUncPath(root)) {
        return [];
    }
    const entries = await (0, promises_1.readdir)(root, { withFileTypes: true }).catch(() => []);
    const dirs = [];
    for (const entry of entries) {
        if (SKIP_DIR_NAMES.has(entry.name)) {
            continue;
        }
        const full = (0, node_path_1.join)(root, entry.name);
        if (isWslUncPath(full)) {
            continue;
        }
        const isDir = entry.isDirectory() ||
            (entry.isSymbolicLink() && ((await (0, promises_1.stat)(full).catch(() => null))?.isDirectory() ?? false));
        if (isDir) {
            dirs.push(full);
        }
    }
    return dirs.sort();
}
async function readPluginManifest(dirPath, kind) {
    const candidateFiles = kind === 'claude'
        ? [(0, node_path_1.join)(dirPath, '.claude-plugin', 'plugin.json'), (0, node_path_1.join)(dirPath, 'plugin.json')]
        : kind === 'codex'
            ? [(0, node_path_1.join)(dirPath, '.codex-plugin', 'plugin.json'), (0, node_path_1.join)(dirPath, 'plugin.json')]
            : [(0, node_path_1.join)(dirPath, 'orca-plugin.json')];
    for (const manifestPath of candidateFiles) {
        const json = await readJsonRecord(manifestPath);
        if (!json) {
            continue;
        }
        const rawId = typeof json.id === 'string' && json.id.trim() ? json.id.trim() : undefined;
        const rawName = typeof json.name === 'string' && json.name.trim() ? json.name.trim() : undefined;
        const pluginName = rawName ?? rawId ?? (0, node_path_1.basename)(dirPath);
        const pluginId = rawId ?? pluginName;
        const marketplace = typeof json.marketplace === 'string' && json.marketplace.trim()
            ? json.marketplace.trim()
            : undefined;
        return {
            installPath: dirPath,
            pluginId,
            pluginName,
            ...(marketplace ? { marketplace } : {})
        };
    }
    return null;
}
async function walkForPluginDirs(root, kind, depth = 0, results = []) {
    if (depth > MAX_WALK_DEPTH || isWslUncPath(root)) {
        return results;
    }
    const manifest = await readPluginManifest(root, kind);
    if (manifest) {
        results.push(manifest);
        return results;
    }
    if (depth === MAX_WALK_DEPTH) {
        return results;
    }
    const subdirs = await listDirectSubdirectories(root);
    for (const subdir of subdirs) {
        if ((0, node_path_1.basename)(subdir).startsWith('.')) {
            continue;
        }
        await walkForPluginDirs(subdir, kind, depth + 1, results);
    }
    return results;
}
async function collectSkillsUnderDirectory(input) {
    const skillDirs = await listDirectSubdirectories(input.skillsRoot);
    for (const skillDir of skillDirs) {
        const id = (0, node_path_1.basename)(skillDir);
        if (id.startsWith('.')) {
            continue;
        }
        const skillFilePath = (0, node_path_1.join)(skillDir, 'SKILL.md');
        const markdown = await readBoundedUtf8(skillFilePath);
        if (markdown === null) {
            continue;
        }
        const realSkillFile = await (0, promises_1.realpath)(skillFilePath).catch(() => skillFilePath);
        if (input.seenRealFiles.has(realSkillFile)) {
            continue;
        }
        input.seenRealFiles.add(realSkillFile);
        const summary = (0, skill_metadata_1.summarizeSkillMarkdown)(markdown);
        const fileStat = await (0, promises_1.stat)(skillFilePath).catch(() => null);
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
        });
    }
}
async function readClaudeEnabledPlugins(homeDirectory, workspaceDirectory) {
    const enabled = new Map();
    const settingsPaths = [
        (0, node_path_1.join)(homeDirectory, '.claude', 'settings.json'),
        ...(workspaceDirectory
            ? [
                (0, node_path_1.join)(workspaceDirectory, '.claude', 'settings.json'),
                (0, node_path_1.join)(workspaceDirectory, '.claude', 'settings.local.json')
            ]
            : [])
    ];
    for (const path of settingsPaths) {
        const json = await readJsonRecord(path);
        const map = json?.enabledPlugins;
        if (map && typeof map === 'object' && !Array.isArray(map)) {
            for (const [key, val] of Object.entries(map)) {
                if (typeof val === 'boolean') {
                    enabled.set(key, val);
                }
            }
        }
    }
    return enabled;
}
function resolveClaudePluginActivation(pluginKey, enabledMap, scope, projectPath, workspaceDirectory) {
    if ((scope === 'project' || scope === 'local') &&
        projectPath &&
        workspaceDirectory &&
        projectPath !== workspaceDirectory) {
        return 'project-scoped-inactive';
    }
    const flag = enabledMap.get(pluginKey);
    if (flag === false) {
        return 'disabled-in-settings';
    }
    return 'active';
}
async function scanReadonlyPluginSkills(input) {
    const records = [];
    const readonlyRoots = new Set();
    const seenRealFiles = new Set();
    const claudeEnabled = await readClaudeEnabledPlugins(input.homeDirectory, input.workspaceDirectory);
    // 1. Claude installed_plugins.json (if present) + fallback directory walk
    const installedPluginsPath = (0, node_path_1.join)(input.homeDirectory, '.claude', 'plugins', 'installed_plugins.json');
    const installedJson = await readJsonRecord(installedPluginsPath);
    const pluginsField = installedJson?.plugins;
    if (pluginsField && typeof pluginsField === 'object' && !Array.isArray(pluginsField)) {
        for (const [fullKey, entries] of Object.entries(pluginsField)) {
            if (!Array.isArray(entries)) {
                continue;
            }
            const [pluginSlug, marketplace] = fullKey.split('@');
            for (const entry of entries) {
                if (!entry || typeof entry !== 'object') {
                    continue;
                }
                const record = entry;
                const installPath = typeof record.installPath === 'string' ? record.installPath : null;
                if (!installPath || isWslUncPath(installPath)) {
                    continue;
                }
                const scopeRaw = record.scope;
                const scope = scopeRaw === 'project' || scopeRaw === 'local' ? scopeRaw : 'user';
                const projectPath = typeof record.projectPath === 'string' ? record.projectPath : undefined;
                const manifest = await readPluginManifest(installPath, 'claude');
                const pluginName = manifest?.pluginName ?? pluginSlug ?? (0, node_path_1.basename)(installPath);
                const pluginId = manifest?.pluginId ?? fullKey;
                readonlyRoots.add(installPath);
                await collectSkillsUnderDirectory({
                    skillsRoot: (0, node_path_1.join)(installPath, 'skills'),
                    agent: 'claude',
                    sourceCategory: 'plugin',
                    scope,
                    pluginId,
                    pluginName,
                    ...(marketplace ? { marketplace } : {}),
                    installPath,
                    activationState: resolveClaudePluginActivation(fullKey, claudeEnabled, scope, projectPath, input.workspaceDirectory),
                    withInvocationCommand: true,
                    seenRealFiles,
                    records
                });
            }
        }
    }
    const claudePluginRoots = [
        { root: (0, node_path_1.join)(input.homeDirectory, '.claude', 'plugins'), scope: 'user' },
        ...(input.workspaceDirectory
            ? [{ root: (0, node_path_1.join)(input.workspaceDirectory, '.claude', 'plugins'), scope: 'project' }]
            : [])
    ];
    for (const { root, scope } of claudePluginRoots) {
        readonlyRoots.add(root);
        const manifests = await walkForPluginDirs(root, 'claude');
        for (const manifest of manifests) {
            readonlyRoots.add(manifest.installPath);
            const flag = claudeEnabled.get(manifest.pluginId);
            await collectSkillsUnderDirectory({
                skillsRoot: (0, node_path_1.join)(manifest.installPath, 'skills'),
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
            });
        }
    }
    // 2. Codex plugins & built-in system skills
    const codexPluginsRoot = (0, node_path_1.join)(input.homeDirectory, '.codex', 'plugins');
    readonlyRoots.add(codexPluginsRoot);
    const codexManifests = await walkForPluginDirs(codexPluginsRoot, 'codex');
    for (const manifest of codexManifests) {
        readonlyRoots.add(manifest.installPath);
        await collectSkillsUnderDirectory({
            skillsRoot: (0, node_path_1.join)(manifest.installPath, 'skills'),
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
        });
    }
    const codexSystemRoot = (0, node_path_1.join)(input.homeDirectory, '.codex', 'skills', '.system');
    readonlyRoots.add(codexSystemRoot);
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
    });
    const etcCodexRoot = input.etcCodexSkillsRoot ?? '/etc/codex/skills';
    if (etcCodexRoot) {
        readonlyRoots.add(etcCodexRoot);
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
        });
    }
    // 3. Cursor built-in readonly skills
    const cursorRoot = (0, node_path_1.join)(input.homeDirectory, '.cursor', 'skills-cursor');
    readonlyRoots.add(cursorRoot);
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
    });
    // 4. Sibling Orca plugins (when pluginRoot is known)
    if (input.pluginRoot && !isWslUncPath(input.pluginRoot)) {
        const pluginsParent = (0, node_path_1.dirname)(input.pluginRoot);
        const siblingDirs = await listDirectSubdirectories(pluginsParent);
        for (const siblingDir of siblingDirs) {
            const manifest = await readPluginManifest(siblingDir, 'orca');
            if (!manifest) {
                continue;
            }
            readonlyRoots.add(siblingDir);
            await collectSkillsUnderDirectory({
                skillsRoot: (0, node_path_1.join)(siblingDir, 'skills'),
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
            });
        }
    }
    records.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return {
        skills: records,
        readonlyRoots: [...readonlyRoots]
    };
}
