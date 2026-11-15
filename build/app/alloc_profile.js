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
exports.ALLOC_PROFILE_MAX_MS = exports.APP_ALLOC_PROFILE_STATE = void 0;
exports.summarizeAllocProfile = summarizeAllocProfile;
exports.startAllocProfile = startAllocProfile;
exports.allocProfileRunning = allocProfileRunning;
exports.snapshotAllocProfile = snapshotAllocProfile;
exports.stopAllocProfile = stopAllocProfile;
/**
 * Zeitlich begrenzte Allokations-Messung (Node-Inspector, Sampling-Heap-Profiler).
 * Zeigt, welche Funktionen am meisten Speicher anfordern (auch kurzlebigen Müll).
 * Läuft nur in den ersten Minuten nach dem Adapterstart und stoppt dann von selbst.
 */
const inspector = __importStar(require("node:inspector"));
exports.APP_ALLOC_PROFILE_STATE = "app.alloc_profile_json";
exports.ALLOC_PROFILE_MAX_MS = 25 * 60 * 1000;
const SAMPLING_INTERVAL_BYTES = 262_144;
function shortFile(url) {
    const i = url.lastIndexOf("/build/");
    if (i >= 0)
        return url.slice(i + 7);
    const j = url.lastIndexOf("/node_modules/");
    if (j >= 0)
        return "node_modules/" + url.slice(j + 14);
    return url.replace(/^node:/, "node:") || "(intern)";
}
/** Profilbaum zu den größten Verursachern zusammenfassen (rein, testbar). */
function summarizeAllocProfile(head, topN = 14) {
    const byFn = new Map();
    const byFile = new Map();
    let total = 0;
    const stack = [head];
    while (stack.length) {
        const n = stack.pop();
        if (n.selfSize > 0) {
            const file = shortFile(n.callFrame.url);
            const fn = n.callFrame.functionName || "(anonym)";
            const key = `${fn}|${file}|${n.callFrame.lineNumber}`;
            const cur = byFn.get(key) ?? { fn, file, line: n.callFrame.lineNumber + 1, mb: 0, bytes: 0 };
            cur.bytes += n.selfSize;
            byFn.set(key, cur);
            byFile.set(file, (byFile.get(file) ?? 0) + n.selfSize);
            total += n.selfSize;
        }
        if (n.children)
            for (const c of n.children)
                stack.push(c);
    }
    const mb = (b) => Math.round((b / 1_048_576) * 10) / 10;
    return {
        totalMb: mb(total),
        top: [...byFn.values()]
            .sort((a, b) => b.bytes - a.bytes)
            .slice(0, topN)
            .map((e) => ({ fn: e.fn, file: e.file, line: e.line, mb: mb(e.bytes) })),
        topFiles: [...byFile.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([file, b]) => ({ file, mb: mb(b) })),
    };
}
let session = null;
let startedMs = 0;
function startAllocProfile(nowMs = Date.now()) {
    if (session)
        return true;
    try {
        const s = new inspector.Session();
        s.connect();
        s.post("HeapProfiler.startSampling", {
            samplingInterval: SAMPLING_INTERVAL_BYTES,
            includeObjectsCollectedByMajorGC: true,
            includeObjectsCollectedByMinorGC: true,
        });
        session = s;
        startedMs = nowMs;
        return true;
    }
    catch {
        session = null;
        return false;
    }
}
function allocProfileRunning() {
    return session !== null;
}
/** Zwischenstand lesen; stoppt die Messung nach ALLOC_PROFILE_MAX_MS. */
function snapshotAllocProfile(nowMs = Date.now()) {
    const s = session;
    if (!s)
        return Promise.resolve(null);
    const stop = nowMs - startedMs >= exports.ALLOC_PROFILE_MAX_MS;
    return new Promise((resolve) => {
        s.post("HeapProfiler.getSamplingProfile", (err, res) => {
            if (err || !res) {
                resolve(null);
                return;
            }
            const sum = summarizeAllocProfile(res.profile.head);
            if (stop) {
                try {
                    s.post("HeapProfiler.stopSampling", () => undefined);
                    s.disconnect();
                }
                catch {
                    /* ignorieren */
                }
                session = null;
            }
            resolve({
                updatedAt: new Date(nowMs).toISOString(),
                sinceSec: Math.round((nowMs - startedMs) / 1000),
                running: !stop,
                ...sum,
            });
        });
    });
}
function stopAllocProfile() {
    if (!session)
        return;
    try {
        session.post("HeapProfiler.stopSampling", () => undefined);
        session.disconnect();
    }
    catch {
        /* ignorieren */
    }
    session = null;
}
