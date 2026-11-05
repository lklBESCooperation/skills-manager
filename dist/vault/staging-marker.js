"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SKILL_VAULT_STAGE_MARKER = void 0;
// SKILL_VAULT_STAGE_MARKER semantics belong to vault adopt transactions; the
// host's staging-names.ts stays upstream-shared. Marker string must stay
// byte-identical to keep host discovery filters recognizing vault staging dirs.
exports.SKILL_VAULT_STAGE_MARKER = '.pmstage-';
