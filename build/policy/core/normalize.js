"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortIssuesDeterministic = exports.normalizeMutualExclusions = exports.normalizeEnergyPriority = exports.normalizeTriState = exports.sortKeysDeep = void 0;
/** Stabile Key-Sortierung für Objekte (rekursiv). */
function sortKeysDeep(value) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => sortKeysDeep(item));
    }
    const obj = value;
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
        const v = obj[key];
        if (v !== undefined) {
            sorted[key] = sortKeysDeep(v);
        }
    }
    return sorted;
}
exports.sortKeysDeep = sortKeysDeep;
function normalizeTriState(raw) {
    if (raw === true || raw === "true" || raw === 1 || raw === "yes") {
        return true;
    }
    if (raw === false || raw === "false" || raw === 0 || raw === "no") {
        return false;
    }
    return "unknown";
}
exports.normalizeTriState = normalizeTriState;
/** energyPriority: Reihenfolge = Priorität — Duplikate entfernen, erste Vorkommen behalten. */
function normalizeEnergyPriority(list) {
    if (!Array.isArray(list)) {
        return [];
    }
    const seen = new Set();
    const out = [];
    for (const item of list) {
        if (typeof item !== "string") {
            continue;
        }
        const s = item.trim();
        if (!s || seen.has(s)) {
            continue;
        }
        seen.add(s);
        out.push(s);
    }
    return out;
}
exports.normalizeEnergyPriority = normalizeEnergyPriority;
/** mutualExclusions: nach id stabil sortieren. */
function normalizeMutualExclusions(rules) {
    if (!Array.isArray(rules)) {
        return [];
    }
    const out = [];
    const seenIds = new Set();
    for (const raw of rules) {
        if (!raw || typeof raw !== "object") {
            continue;
        }
        const r = raw;
        const id = typeof r.id === "string" ? r.id.trim() : "";
        const addonA = typeof r.addonA === "string" ? r.addonA.trim() : "";
        const addonB = typeof r.addonB === "string" ? r.addonB.trim() : "";
        if (!id || !addonA || !addonB || seenIds.has(id)) {
            continue;
        }
        if (addonA === addonB) {
            continue;
        }
        seenIds.add(id);
        out.push({
            id,
            addonA,
            addonB,
            ...(typeof r.reason === "string" && r.reason.trim() ? { reason: r.reason.trim() } : {}),
        });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}
exports.normalizeMutualExclusions = normalizeMutualExclusions;
function sortIssuesDeterministic(issues) {
    return [...issues].sort((a, b) => {
        const sev = { error: 0, warning: 1, info: 2 }[a.severity] -
            { error: 0, warning: 1, info: 2 }[b.severity];
        if (sev !== 0) {
            return sev;
        }
        const code = a.code.localeCompare(b.code);
        if (code !== 0) {
            return code;
        }
        const pathA = a.path ?? "";
        const pathB = b.path ?? "";
        const path = pathA.localeCompare(pathB);
        if (path !== 0) {
            return path;
        }
        return a.message.localeCompare(b.message);
    });
}
exports.sortIssuesDeterministic = sortIssuesDeterministic;
