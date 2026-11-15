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
exports.floorHour = exports.PV_HISTORY_KEEP_MS = exports.PV_HOURLY_HISTORY_FILE = exports.PV_HOURLY_HISTORY_CATEGORY = void 0;
exports.emptyPvHourlyHistory = emptyPvHourlyHistory;
exports.readPvHourlyHistory = readPvHourlyHistory;
exports.writePvHourlyHistory = writePvHourlyHistory;
exports.mergePvHistory = mergePvHistory;
exports.brightskyHourlyKwh = brightskyHourlyKwh;
/**
 * Verlauf der PV-Stundenprognosen für die Betriebsseite (EMS-Prognose und Brightsky),
 * damit vergangene Stunden im Rückblick (−1/−2 Tage) erhalten bleiben.
 * Reine Anzeige-Daten — keine Planungslogik.
 */
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
exports.PV_HOURLY_HISTORY_CATEGORY = "learning/pv_hourly_history";
exports.PV_HOURLY_HISTORY_FILE = "pv_hourly_history_v1.json";
exports.PV_HISTORY_KEEP_MS = 10 * 24 * 3_600_000;
const HOUR_MS = 3_600_000;
function emptyPvHourlyHistory() {
    return { version: 1, f: {}, b: {} };
}
const floorHour = (ms) => Math.floor(ms / HOUR_MS) * HOUR_MS;
exports.floorHour = floorHour;
function cleanMap(raw) {
    const out = {};
    if (raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw)) {
            if (/^\d{10,14}$/.test(k) && typeof v === "number" && Number.isFinite(v) && v >= 0)
                out[k] = v;
        }
    }
    return out;
}
async function readPvHourlyHistory(dir) {
    try {
        const p = JSON.parse(await fs.readFile(path.join(dir, exports.PV_HOURLY_HISTORY_FILE), "utf8"));
        if (p?.version === 1)
            return { version: 1, f: cleanMap(p.f), b: cleanMap(p.b) };
    }
    catch {
        /* neu anlegen */
    }
    return emptyPvHourlyHistory();
}
async function writePvHourlyHistory(dir, h) {
    await fs.mkdir(dir, { recursive: true });
    await (0, atomic_write_1.atomicWriteFile)(path.join(dir, exports.PV_HOURLY_HISTORY_FILE), `${JSON.stringify(h)}\n`);
}
const round3 = (n) => Math.round(n * 1000) / 1000;
/**
 * Neue Werte einmischen: Stunden ab der laufenden Stunde werden fortgeschrieben,
 * frühere Stunden bleiben eingefroren. Älteres als 10 Tage wird entfernt.
 */
function mergePvHistory(prev, nowMs, forecast, brightsky) {
    const cur = (0, exports.floorHour)(nowMs);
    const cutoff = nowMs - exports.PV_HISTORY_KEEP_MS;
    const next = { version: 1, f: {}, b: {} };
    for (const [k, v] of Object.entries(prev.f))
        if (Number(k) >= cutoff)
            next.f[k] = v;
    for (const [k, v] of Object.entries(prev.b))
        if (Number(k) >= cutoff)
            next.b[k] = v;
    for (const [t, v] of forecast)
        if (t >= cur && Number.isFinite(v) && v >= 0)
            next.f[String(t)] = round3(v);
    for (const [t, v] of brightsky)
        if (t >= cur && Number.isFinite(v) && v >= 0)
            next.b[String(t)] = round3(v);
    return next;
}
function localDateKey(ms, timeZone) {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
/**
 * Stundenkurve aus Brightsky: Verlauf nach Einstrahlung, Tagessumme = Tagesschätzung.
 * Nur Tage mit lückenloser Abdeckung der Tagesstunden (sonst wäre die Skalierung falsch);
 * für den angebrochenen heutigen Tag bleibt der gespeicherte Verlauf von gestern gültig.
 */
function brightskyHourlyKwh(points, dailyKwhByDate, timeZone) {
    const byDay = new Map();
    for (const p of points) {
        if (!Number.isFinite(p.startMs) || !Number.isFinite(p.solar) || p.solar < 0)
            continue;
        const k = localDateKey(p.startMs, timeZone);
        const a = byDay.get(k) ?? [];
        a.push(p);
        byDay.set(k, a);
    }
    const out = new Map();
    for (const [day, pts] of byDay) {
        const est = dailyKwhByDate.get(day);
        if (est === undefined || !(est > 0))
            continue;
        /* Volltag: 24 Stunden (23/25 bei Zeitumstellung) */
        if (pts.length < 23)
            continue;
        const sum = pts.reduce((s, p) => s + p.solar, 0);
        if (!(sum > 0))
            continue;
        for (const p of pts)
            out.set((0, exports.floorHour)(p.startMs), (p.solar / sum) * est);
    }
    return out;
}
