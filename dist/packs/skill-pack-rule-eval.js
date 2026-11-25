"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateDynamicPack = evaluateDynamicPack;
exports.dynamicPackMemberIds = dynamicPackMemberIds;
const skill_pack_contract_1 = require("../contracts/skill-pack-contract");
const CONFLICT_SOURCE_KIND = 'conflict';
function allowlist(value) {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}
function equalsCI(actual, expected) {
    return actual != null && actual.toLowerCase() === expected.toLowerCase();
}
function oneOfCI(actual, options) {
    if (actual == null) {
        return false;
    }
    const lowered = actual.toLowerCase();
    return options.some((option) => option.toLowerCase() === lowered);
}
function startsWithCI(actual, prefix) {
    return actual != null && actual.toLowerCase().startsWith(prefix.toLowerCase());
}
function containsCI(actual, needle) {
    return actual != null && actual.toLowerCase().includes(needle.toLowerCase());
}
function matchScalarOp(actual, op, value, caseInsensitive = true) {
    switch (op) {
        case 'eq':
            return caseInsensitive ? equalsCI(actual, value) : actual === value;
        case 'neq':
            return caseInsensitive ? !equalsCI(actual, value) : actual !== value;
        case 'in':
            return caseInsensitive
                ? oneOfCI(actual, allowlist(value))
                : actual != null && allowlist(value).includes(actual);
        case 'not_in':
            return caseInsensitive
                ? !oneOfCI(actual, allowlist(value))
                : actual == null || !allowlist(value).includes(actual);
        case 'prefix':
            return caseInsensitive
                ? startsWithCI(actual, value)
                : actual != null && actual.startsWith(value);
        case 'contains':
            return caseInsensitive
                ? containsCI(actual, value)
                : actual != null && actual.includes(value);
    }
}
function matchListOp(values, op, rawValue) {
    const options = allowlist(rawValue);
    switch (op) {
        case 'eq':
            return values.includes(rawValue);
        case 'neq':
            return !values.includes(rawValue);
        case 'in':
            return options.some((opt) => values.includes(opt));
        case 'not_in':
            return options.every((opt) => !values.includes(opt));
        case 'prefix':
            return values.some((val) => val.startsWith(rawValue));
        case 'contains':
            return values.some((val) => val.toLowerCase().includes(rawValue.toLowerCase()));
    }
}
function conditionMatchesEntry(condition, entry) {
    const { op, value } = condition;
    switch (condition.field) {
        case 'tag':
            return matchListOp(entry.tags, op, value);
        case 'author':
            return matchScalarOp(entry.author, op, value, true);
        case 'sourceKind':
            return matchScalarOp(entry.sourceKind, op, value, false);
        case 'namePrefix':
            if (op === 'neq' || op === 'not_in') {
                return (matchScalarOp(entry.id, op, value, false) &&
                    matchScalarOp(entry.name, op, value, false));
            }
            return (matchScalarOp(entry.id, op, value, op === 'contains') ||
                matchScalarOp(entry.name, op, value, op === 'contains') ||
                (op === 'contains' && containsCI(entry.description, value)));
        case 'scope': {
            const normalizedActual = (entry.scope ?? 'user') === 'project' ? 'project' : 'user';
            const normalizedValue = value.toLowerCase() === 'workspace' ? 'project' : value;
            return matchScalarOp(normalizedActual, op, normalizedValue, true);
        }
        case 'agent':
            return matchListOp(entry.agents ?? [], op, value);
        case 'originRoot':
            return matchScalarOp(entry.originRoot, op, value, true);
        case 'enabled': {
            const actual = entry.enabled === undefined ? null : entry.enabled ? 'true' : 'false';
            return matchScalarOp(actual, op, value, true);
        }
    }
}
function evaluateGroup(group, entry) {
    const evaluateItem = (item) => 'conditions' in item ? evaluateGroup(item, entry) : conditionMatchesEntry(item, entry);
    return group.logic === 'and'
        ? group.conditions.every(evaluateItem)
        : group.conditions.some(evaluateItem);
}
/**
 * ⑤ read-time evaluation of a dynamic pack rule (v1 or v2) against vault index entries.
 * Pure: conflict and readonly plugin entries never match.
 */
function evaluateDynamicPack(rule, entries) {
    return entries.filter((entry) => {
        if (entry.readonly === true || entry.sourceKind === CONFLICT_SOURCE_KIND) {
            return false;
        }
        return (0, skill_pack_contract_1.isDynamicRuleV2)(rule)
            ? evaluateGroup(rule, entry)
            : rule.match.every((condition) => conditionMatchesEntry(condition, entry));
    });
}
function dynamicPackMemberIds(rule, entries) {
    return evaluateDynamicPack(rule, entries).map((entry) => entry.id);
}
