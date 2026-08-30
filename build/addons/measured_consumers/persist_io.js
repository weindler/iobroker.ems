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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeMeasuredConsumersPersist = exports.readMeasuredConsumersPersist = exports.applyTauchpumpeWhResetMigration = exports.TAUCHPUMPE_WH_RESET_MIGRATION_ID = exports.TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const persist_1 = require("./persist");
/** Exakter Persist-Key der Tauchpumpe (Wh-Alias-Fehlbuchung vor Korrektur). */
exports.TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY = "alias.0.Garten.Sensoren.Tauchpumpe_Bewässerung.Aktuelle_Leistung";
exports.TAUCHPUMPE_WH_RESET_MIGRATION_ID = "tauchpumpe_wh_reset_v1";
/**
 * Einmal-Reset nur für die Tauchpumpe nach Wh→kWh-Alias-Korrektur.
 * Verwirft falsche days/total/baseline; nächstes Sample initialisiert neu mit initial_energy_kwh.
 */
function applyTauchpumpeWhResetMigration(persist) {
    const applied = new Set(persist.migrationsApplied ?? []);
    if (applied.has(exports.TAUCHPUMPE_WH_RESET_MIGRATION_ID)) {
        return { persist, reset: false };
    }
    const key = exports.TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY;
    const nextSlots = { ...persist.slots };
    let reset = false;
    if (nextSlots[key]) {
        nextSlots[key] = (0, persist_1.emptyMeasuredConsumerSlotPersist)();
        reset = true;
    }
    applied.add(exports.TAUCHPUMPE_WH_RESET_MIGRATION_ID);
    return {
        persist: {
            version: 1,
            slots: nextSlots,
            migrationsApplied: [...applied],
        },
        reset,
    };
}
exports.applyTauchpumpeWhResetMigration = applyTauchpumpeWhResetMigration;
async function readMeasuredConsumersPersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, persist_1.MEASURED_CONSUMERS_RUNTIME_FILENAME), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1 && parsed.slots && typeof parsed.slots === "object") {
            const slots = {};
            for (const [key, slot] of Object.entries(parsed.slots)) {
                if (!slot || typeof slot !== "object")
                    continue;
                slots[key] = {
                    initialized: Boolean(slot.initialized),
                    rawEnergyBaselineKwh: typeof slot.rawEnergyBaselineKwh === "number" && Number.isFinite(slot.rawEnergyBaselineKwh)
                        ? slot.rawEnergyBaselineKwh
                        : null,
                    lastPowerTsMs: typeof slot.lastPowerTsMs === "number" && Number.isFinite(slot.lastPowerTsMs)
                        ? slot.lastPowerTsMs
                        : null,
                    totalKwh: typeof slot.totalKwh === "number" && Number.isFinite(slot.totalKwh) ? slot.totalKwh : 0,
                    days: slot.days && typeof slot.days === "object" && !Array.isArray(slot.days)
                        ? { ...slot.days }
                        : {},
                };
            }
            const base = {
                version: 1,
                slots,
                migrationsApplied: Array.isArray(parsed.migrationsApplied)
                    ? parsed.migrationsApplied.filter((x) => typeof x === "string")
                    : [],
            };
            return applyTauchpumpeWhResetMigration(base).persist;
        }
    }
    catch {
        // neu / noch keine Persistenz vorhanden
    }
    const empty = (0, persist_1.emptyMeasuredConsumersPersist)();
    empty.migrationsApplied = [exports.TAUCHPUMPE_WH_RESET_MIGRATION_ID];
    return empty;
}
exports.readMeasuredConsumersPersist = readMeasuredConsumersPersist;
async function writeMeasuredConsumersPersist(baseDir, persist) {
    await fs.mkdir(baseDir, { recursive: true });
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, persist_1.MEASURED_CONSUMERS_RUNTIME_FILENAME), `${JSON.stringify(persist, null, 2)}\n`, { mode: atomic_write_1.DIAGNOSTIC_FILE_MODE });
}
exports.writeMeasuredConsumersPersist = writeMeasuredConsumersPersist;
