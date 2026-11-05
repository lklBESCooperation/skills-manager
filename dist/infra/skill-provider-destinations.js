"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSkillProviderDestinations = resolveSkillProviderDestinations;
const node_path_1 = require("node:path");
const skill_install_providers_1 = require("../contracts/skill-install-providers");
function normalizedPath(path) {
    const normalized = (0, node_path_1.resolve)(path);
    return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}
function resolveSkillProviderDestinations(input) {
    const detected = new Set(input.detectedProviders.filter(skill_install_providers_1.isSkillInstallProviderId));
    const scopeRoot = input.scope === 'global' ? input.homeDirectory : input.workspaceDirectory;
    if (!scopeRoot) {
        throw new Error('skill-install-workspace-required');
    }
    const destinations = [];
    const canonicalRoot = (0, node_path_1.join)(scopeRoot, '.agents', 'skills');
    const claimedPlacementRoots = new Set();
    for (const provider of skill_install_providers_1.SKILL_INSTALL_PROVIDERS) {
        if (!detected.has(provider.id)) {
            continue;
        }
        const segments = input.scope === 'global' ? provider.globalSegments : provider.workspaceSegments;
        const overriddenRoot = input.scope === 'global' ? input.providerRootOverrides?.[provider.id] : undefined;
        const rootPath = overriddenRoot
            ? overriddenRoot
            : segments
                ? (0, node_path_1.join)(scopeRoot, ...segments)
                : canonicalRoot;
        const readsCanonicalRoot = normalizedPath(rootPath) === normalizedPath(canonicalRoot);
        if (!readsCanonicalRoot) {
            const normalizedRoot = normalizedPath(rootPath);
            if (claimedPlacementRoots.has(normalizedRoot)) {
                throw new Error('skill-install-provider-root-collision');
            }
            claimedPlacementRoots.add(normalizedRoot);
        }
        destinations.push({ provider: provider.id, readsCanonicalRoot, rootPath });
    }
    return destinations;
}
