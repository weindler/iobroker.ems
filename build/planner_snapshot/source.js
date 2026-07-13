"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonStringValue = exports.boolValue = exports.strValue = exports.numValue = exports.CachedPlannerSnapshotSource = void 0;
/** Wraps a source and caches each state/foreign read exactly once. */
class CachedPlannerSnapshotSource {
    inner;
    readCounts = new Map();
    stateCache = new Map();
    foreignCache = new Map();
    constructor(inner) {
        this.inner = inner;
    }
    bump(key) {
        this.readCounts.set(key, (this.readCounts.get(key) ?? 0) + 1);
    }
    async readState(id) {
        const key = `state:${id}`;
        this.bump(key);
        if (!this.stateCache.has(id)) {
            this.stateCache.set(id, await this.inner.readState(id));
        }
        return this.stateCache.get(id);
    }
    async readForeignState(id) {
        const key = `foreign:${id}`;
        this.bump(key);
        if (!this.foreignCache.has(id)) {
            this.foreignCache.set(id, await this.inner.readForeignState(id));
        }
        return this.foreignCache.get(id);
    }
    async readJsonFile(absolutePath) {
        this.bump(`file:${absolutePath}`);
        return this.inner.readJsonFile(absolutePath);
    }
    async readConfig() {
        this.bump("config");
        return this.inner.readConfig();
    }
    now() {
        return this.inner.now();
    }
}
exports.CachedPlannerSnapshotSource = CachedPlannerSnapshotSource;
function numValue(st) {
    const v = st.value;
    if (v === null || v === undefined)
        return null;
    if (typeof v === "number" && Number.isFinite(v))
        return v;
    if (typeof v === "string" && v.trim() !== "") {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
exports.numValue = numValue;
function strValue(st) {
    const v = st.value;
    if (v === null || v === undefined)
        return null;
    const s = String(v).trim();
    return s === "" ? null : s;
}
exports.strValue = strValue;
function boolValue(st) {
    const v = st.value;
    if (v === true || v === false)
        return v;
    if (v === 1 || v === "1" || v === "true")
        return true;
    if (v === 0 || v === "0" || v === "false")
        return false;
    return null;
}
exports.boolValue = boolValue;
function jsonStringValue(st) {
    return strValue(st);
}
exports.jsonStringValue = jsonStringValue;
