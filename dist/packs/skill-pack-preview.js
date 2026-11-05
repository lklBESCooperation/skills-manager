"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.previewSkillPack = previewSkillPack;
function previewSkillPack(input) {
    const missing = new Set([...input.members].filter((id) => !input.installed.has(id)));
    const available = new Set([...input.members].filter((id) => input.installed.has(id)));
    const target = input.mode === 'apply' ? new Set([...input.current, ...available]) : available;
    return {
        enable: new Set([...target].filter((id) => !input.current.has(id))),
        disable: new Set([...input.current].filter((id) => !target.has(id))),
        keep: new Set([...input.current].filter((id) => target.has(id))),
        missing
    };
}
