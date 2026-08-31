"use strict";
/**
 * PHASE 6 — Persistenz des KI-Override-Ledgers.
 *
 * Restorewürdig (kleine, langlebige Entscheidungs-Historie) — analog
 * `learning/daily_evaluator/learning_state_v1.json`, siehe `.cursor/rules` Persistenz-Konvention.
 */
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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendOverrideToLedger = exports.writeOverrideLedgerStore = exports.readOverrideLedgerStore = exports.emptyOverrideLedgerStore = exports.AI_OVERRIDE_LEDGER_MAX_ENTRIES = exports.AI_OVERRIDE_LEDGER_FILE = exports.AI_OVERRIDE_LEDGER_CATEGORY = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const validate_1 = require("./validate");
exports.AI_OVERRIDE_LEDGER_CATEGORY = "ai/override_ledger";
exports.AI_OVERRIDE_LEDGER_FILE = "override_ledger_v1.json";
/** Ledger bleibt klein — nur zuletzt aktive/abgelaufene/abgelehnte Einträge behalten. */
exports.AI_OVERRIDE_LEDGER_MAX_ENTRIES = 500;
function emptyOverrideLedgerStore() {
    return { module: "ai_override_ledger", schemaVersion: 1, updatedAtIso: new Date(0).toISOString(), overrides: [] };
}
exports.emptyOverrideLedgerStore = emptyOverrideLedgerStore;
function ledgerPath(baseDir) {
    return path.join(baseDir, exports.AI_OVERRIDE_LEDGER_FILE);
}
async function readOverrideLedgerStore(baseDir) {
    if (!baseDir)
        return emptyOverrideLedgerStore();
    try {
        const raw = await fs.readFile(ledgerPath(baseDir), "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.module !== "ai_override_ledger" || !Array.isArray(parsed.overrides)) {
            return emptyOverrideLedgerStore();
        }
        return {
            module: "ai_override_ledger",
            schemaVersion: 1,
            updatedAtIso: typeof parsed.updatedAtIso === "string" ? parsed.updatedAtIso : new Date(0).toISOString(),
            overrides: parsed.overrides,
        };
    }
    catch {
        return emptyOverrideLedgerStore();
    }
}
exports.readOverrideLedgerStore = readOverrideLedgerStore;
async function writeOverrideLedgerStore(baseDir, store) {
    await (0, atomic_write_1.atomicWriteFile)(ledgerPath(baseDir), `${JSON.stringify(store)}\n`, { mode: atomic_write_1.DIAGNOSTIC_FILE_MODE });
}
exports.writeOverrideLedgerStore = writeOverrideLedgerStore;
/** Neuen validierten Override anhängen, TTL-Sweep anwenden, Ledger auf Maximalgröße begrenzen. */
async function appendOverrideToLedger(baseDir, override, now = new Date()) {
    const store = await readOverrideLedgerStore(baseDir);
    const swept = (0, validate_1.sweepExpiredOverrides)([...store.overrides, override], now);
    const trimmed = swept.length > exports.AI_OVERRIDE_LEDGER_MAX_ENTRIES ? swept.slice(-exports.AI_OVERRIDE_LEDGER_MAX_ENTRIES) : swept;
    const next = {
        module: "ai_override_ledger",
        schemaVersion: 1,
        updatedAtIso: now.toISOString(),
        overrides: trimmed,
    };
    await writeOverrideLedgerStore(baseDir, next);
    return next;
}
exports.appendOverrideToLedger = appendOverrideToLedger;
