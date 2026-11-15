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
exports.PRICE_HISTORY_KEEP_MS = exports.PRICE_HISTORY_FILE = exports.PRICE_HISTORY_CATEGORY = void 0;
exports.emptyPriceHistory = emptyPriceHistory;
exports.readPriceHistory = readPriceHistory;
exports.writePriceHistory = writePriceHistory;
exports.mergePriceHistory = mergePriceHistory;
/**
 * Verlauf der echten Preise (ct/kWh je Viertelstunde) für den Rückblick der Preisgrafik.
 * Reine Anzeige-Daten: gespeichert wird nur, was bereits als veröffentlichter Preis vorliegt.
 */
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
exports.PRICE_HISTORY_CATEGORY = "learning/vis_price_history";
exports.PRICE_HISTORY_FILE = "price_history_v1.json";
exports.PRICE_HISTORY_KEEP_MS = 72 * 3_600_000;
function emptyPriceHistory() {
    return { version: 1, a: {} };
}
async function readPriceHistory(dir) {
    try {
        const p = JSON.parse(await fs.readFile(path.join(dir, exports.PRICE_HISTORY_FILE), "utf8"));
        if (p?.version === 1 && p.a && typeof p.a === "object") {
            const a = {};
            for (const [k, v] of Object.entries(p.a)) {
                if (/^\d{10,14}$/.test(k) && typeof v === "number" && Number.isFinite(v))
                    a[k] = v;
            }
            return { version: 1, a };
        }
    }
    catch {
        /* neu anlegen */
    }
    return emptyPriceHistory();
}
async function writePriceHistory(dir, h) {
    await fs.mkdir(dir, { recursive: true });
    await (0, atomic_write_1.atomicWriteFile)(path.join(dir, exports.PRICE_HISTORY_FILE), `${JSON.stringify(h)}\n`);
}
/**
 * Echte (nicht prognostizierte) Preise einmischen. Bereits Gespeichertes bleibt unverändert,
 * außer der Preis wurde nachträglich korrigiert. Älteres als 72 h entfällt.
 * `changed` ist false, wenn nichts neu ist (dann muss nicht geschrieben werden).
 */
function mergePriceHistory(prev, nowMs, actual) {
    const a = { ...prev.a };
    let changed = false;
    for (const [start, ct] of actual) {
        if (!Number.isFinite(start) || !Number.isFinite(ct))
            continue;
        if (start < nowMs - exports.PRICE_HISTORY_KEEP_MS)
            continue;
        const key = String(start);
        const v = Math.round(ct * 1000) / 1000;
        if (a[key] !== v) {
            a[key] = v;
            changed = true;
        }
    }
    for (const key of Object.keys(a)) {
        if (nowMs - Number(key) > exports.PRICE_HISTORY_KEEP_MS) {
            delete a[key];
            changed = true;
        }
    }
    return { history: { version: 1, a }, changed };
}
