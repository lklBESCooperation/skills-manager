"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeSkillMarkdown = summarizeSkillMarkdown;
function stripQuotePair(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}
function parseYamlFrontmatter(raw) {
    const lines = raw.replace(/\r\n/g, '\n').replace(/\r$/, '').split('\n');
    const data = {};
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
        if (!match) {
            index += 1;
            continue;
        }
        const key = match[1];
        const value = match[2].trim();
        if (value === '|' || value === '|-' || value === '>' || value === '>-') {
            const block = [];
            index += 1;
            while (index < lines.length && /^(?:\s{2,}|\s*$)/.test(lines[index])) {
                block.push(lines[index].replace(/^\s{2}/, ''));
                index += 1;
            }
            data[key] = block
                .join(value.startsWith('>') ? ' ' : '\n')
                .replace(/\s+/g, ' ')
                .trim();
            continue;
        }
        if (value === '') {
            const items = [];
            index += 1;
            while (index < lines.length) {
                const itemMatch = /^\s*-\s*(.+)$/.exec(lines[index]);
                if (!itemMatch) {
                    break;
                }
                items.push(stripQuotePair(itemMatch[1]));
                index += 1;
            }
            if (items.length > 0) {
                data[key] = items;
                continue;
            }
            data[key] = '';
            continue;
        }
        data[key] = stripQuotePair(value);
        index += 1;
    }
    return data;
}
function firstHeading(body) {
    const match = /^#\s+(.+)$/m.exec(body);
    return match?.[1].trim() || null;
}
function firstParagraph(body) {
    const lines = body.replace(/\r\n/g, '\n').split('\n');
    const paragraph = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('```')) {
            if (paragraph.length > 0) {
                break;
            }
            continue;
        }
        paragraph.push(trimmed);
        if (paragraph.join(' ').length > 240) {
            break;
        }
    }
    return paragraph.length > 0 ? paragraph.join(' ') : null;
}
function summarizeSkillMarkdown(markdown) {
    const normalized = markdown.replace(/^\uFEFF/, '');
    const frontmatterMatch = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(normalized);
    const body = frontmatterMatch ? normalized.slice(frontmatterMatch[0].length) : normalized;
    const frontmatter = frontmatterMatch ? parseYamlFrontmatter(frontmatterMatch[1]) : {};
    const nameValue = frontmatter.name;
    const descriptionValue = frontmatter.description;
    const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : firstHeading(body);
    const description = typeof descriptionValue === 'string' && descriptionValue.trim()
        ? descriptionValue.trim()
        : firstParagraph(body);
    return {
        name: name || null,
        description: description || null
    };
}
