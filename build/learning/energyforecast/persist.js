"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.localDay = exports.ACTUAL_RETENTION_MS = exports.SNAPSHOT_RETENTION_MS = exports.EF_BIAS_FILE = exports.EF_SNAPSHOT_FILE = exports.EF_CACHE_FILE = void 0;
exports.emptyCache = emptyCache;
exports.emptySnapshotFile = emptySnapshotFile;
exports.readCache = readCache;
exports.writeCache = writeCache;
exports.readSnapshots = readSnapshots;
exports.writeSnapshots = writeSnapshots;
exports.readBiasHistory = readBiasHistory;
exports.writeBiasHistory = writeBiasHistory;
exports.addFetchToSnapshots = addFetchToSnapshots;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const parse_1 = require("./parse");
Object.defineProperty(exports, "localDay", { enumerable: true, get: function () { return parse_1.localDay; } });
exports.EF_CACHE_FILE = "cache_v1.json";
exports.EF_SNAPSHOT_FILE = "snapshots_v1.json";
exports.EF_BIAS_FILE = "bias_history_v1.json";
exports.SNAPSHOT_RETENTION_MS = 16 * 86_400_000;
exports.ACTUAL_RETENTION_MS = 30 * 86_400_000;
function emptyCache() {
    return {
        version: 1,
        fetchedAtIso: null,
        lastAttemptMs: 0,
        lastError: null,
        lastErrorStatus: null,
        plan: null,
        generatedAtIso: null,
        validUntilIso: null,
        slots: [],
    };
}
function emptySnapshotFile() {
    return { version: 1, snapshots: [], actual: {} };
}
async function readJson(file) {
    try {
        return JSON.parse(await fs.readFile(file, "utf8"));
    }
    catch {
        return null;
    }
}
async function readCache(dir) {
    const c = await readJson(path.join(dir, exports.EF_CACHE_FILE));
    return c && c.version === 1 && Array.isArray(c.slots) ? c : emptyCache();
}
async function writeCache(dir, cache) {
    await fs.mkdir(dir, { recursive: true });
    await (0, atomic_write_1.atomicWriteFile)(path.join(dir, exports.EF_CACHE_FILE), `${JSON.stringify(cache)}\n`);
}
async function readSnapshots(dir) {
    const s = await readJson(path.join(dir, exports.EF_SNAPSHOT_FILE));
    return s && s.version === 1 && Array.isArray(s.snapshots) && s.actual ? s : emptySnapshotFile();
}
async function writeSnapshots(dir, file) {
    await fs.mkdir(dir, { recursive: true });
    await (0, atomic_write_1.atomicWriteFile)(path.join(dir, exports.EF_SNAPSHOT_FILE), `${JSON.stringify(file)}\n`);
}
async function readBiasHistory(dir) {
    const f = await readJson(path.join(dir, exports.EF_BIAS_FILE));
    return f && f.version === 1 && Array.isArray(f.entries) ? f.entries : [];
}
async function writeBiasHistory(dir, entries) {
    await fs.mkdir(dir, { recursive: true });
    await (0, atomic_write_1.atomicWriteFile)(path.join(dir, exports.EF_BIAS_FILE), `${JSON.stringify({ version: 1, entries })}\n`);
}
function sameSlots(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i][0] !== b[i][0] || Math.abs(a[i][1] - b[i][1]) > 1e-6)
            return false;
    }
    return true;
}
/**
 * Neuen Abruf einarbeiten: Prognose-Slots als Snapshot festhalten (nur wenn sich etwas geändert hat),
 * Markt-Slots als echte Preise ablegen, Altes entfernen. Rein, gibt neue Datei zurück.
 */
function addFetchToSnapshots(file, parsed, nowMs) {
    const actual = { ...file.actual };
    for (const s of parsed.slots)
        if (s.origin === "market")
            actual[String(s.startMs)] = s.totalCt;
    const fc = parsed.slots
        .filter((s) => s.origin === "forecast" && s.startMs > nowMs - 15 * 60_000)
        .map((s) => [s.startMs, s.totalCt]);
    let snapshots = file.snapshots;
    const last = snapshots[snapshots.length - 1];
    if (fc.length > 0 && !(last && sameSlots(last.slots, fc))) {
        snapshots = [...snapshots, { atMs: nowMs, slots: fc }];
    }
    snapshots = snapshots.filter((s) => nowMs - s.atMs <= exports.SNAPSHOT_RETENTION_MS);
    for (const key of Object.keys(actual)) {
        if (nowMs - Number(key) > exports.ACTUAL_RETENTION_MS)
            delete actual[key];
    }
    return { version: 1, snapshots, actual };
}
