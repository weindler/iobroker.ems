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
exports.persistTauchpumpeWhResetMigrationIfNeeded = exports.writeMeasuredConsumersPersist = exports.readMeasuredConsumersPersist = exports.applyTauchpumpeWhResetMigration = exports.TAUCHPUMPE_WH_RESET_MIGRATION_ID = exports.TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const persist_1 = require("./persist");
/** Exakter Persist-Key der Tauchpumpe (Wh-Alias-Fehlbuchung vor Korrektur). */
exports.TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY = "alias.0.Garten.Sensoren.Tauchpumpe_Bewässerung.Aktuelle_Leistung";
exports.TAUCHPUMPE_WH_RESET_MIGRATION_ID = "tauchpumpe_wh_reset_v1";
/**
 * Einmal-Reset nur für die Tauchpumpe nach Wh→kWh-Alias-Korrektur.
 * Entfernt den Slot komplett — nächstes Sample initialisiert neu mit initial_energy_kwh.
 *
 * Marker wird nur gesetzt, wenn:
 * - Slot gefunden und entfernt, oder
 * - Slot bewusst nicht vorhanden (nichts zu migrieren).
 */
function applyTauchpumpeWhResetMigration(persist) {
    const applied = new Set(persist.migrationsApplied ?? []);
    if (applied.has(exports.TAUCHPUMPE_WH_RESET_MIGRATION_ID)) {
        return {
            persist,
            changed: false,
            matched: false,
            alreadyApplied: true,
            previousRawEnergyBaselineKwh: null,
        };
    }
    const key = exports.TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY;
    const nextSlots = { ...persist.slots };
    const existing = nextSlots[key];
    const matched = existing !== undefined;
    let previousRawEnergyBaselineKwh = null;
    if (matched) {
        previousRawEnergyBaselineKwh =
            typeof existing.rawEnergyBaselineKwh === "number" && Number.isFinite(existing.rawEnergyBaselineKwh)
                ? existing.rawEnergyBaselineKwh
                : null;
        delete nextSlots[key];
    }
    applied.add(exports.TAUCHPUMPE_WH_RESET_MIGRATION_ID);
    return {
        persist: {
            version: 1,
            slots: nextSlots,
            migrationsApplied: [...applied],
        },
        changed: true,
        matched,
        alreadyApplied: false,
        previousRawEnergyBaselineKwh,
    };
}
exports.applyTauchpumpeWhResetMigration = applyTauchpumpeWhResetMigration;
/** Reiner Dateileser — ohne Migration (Migration läuft in hydrate + sofortigem Write). */
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
            return {
                version: 1,
                slots,
                migrationsApplied: Array.isArray(parsed.migrationsApplied)
                    ? parsed.migrationsApplied.filter((x) => typeof x === "string")
                    : [],
            };
        }
    }
    catch {
        // neu / noch keine Persistenz vorhanden
    }
    return (0, persist_1.emptyMeasuredConsumersPersist)();
}
exports.readMeasuredConsumersPersist = readMeasuredConsumersPersist;
async function writeMeasuredConsumersPersist(baseDir, persist) {
    await fs.mkdir(baseDir, { recursive: true });
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, persist_1.MEASURED_CONSUMERS_RUNTIME_FILENAME), `${JSON.stringify(persist, null, 2)}\n`, { mode: atomic_write_1.DIAGNOSTIC_FILE_MODE });
}
exports.writeMeasuredConsumersPersist = writeMeasuredConsumersPersist;
/**
 * Wendet Tauchpumpen-Migration an und schreibt bei Änderung sofort atomar.
 * Bei Write-Fehler: Marker/Reset gelten als nicht abgeschlossen (unveränderter Stand bleibt).
 */
async function persistTauchpumpeWhResetMigrationIfNeeded(baseDir, current, host) {
    const result = applyTauchpumpeWhResetMigration(current);
    if (!result.changed) {
        return result.persist;
    }
    try {
        await writeMeasuredConsumersPersist(baseDir, result.persist);
    }
    catch (e) {
        host?.log?.warn?.(`measured_consumers migration ${exports.TAUCHPUMPE_WH_RESET_MIGRATION_ID} write failed — not marked applied: ${e instanceof Error ? e.message : String(e)}`);
        return current;
    }
    if (result.matched) {
        const prev = result.previousRawEnergyBaselineKwh != null
            ? ` (previous rawEnergyBaselineKwh=${result.previousRawEnergyBaselineKwh})`
            : "";
        host?.log?.info?.(`Measured Consumers migration ${exports.TAUCHPUMPE_WH_RESET_MIGRATION_ID} applied and persisted${prev}`);
    }
    else {
        host?.log?.info?.(`Measured Consumers migration ${exports.TAUCHPUMPE_WH_RESET_MIGRATION_ID} marked applied (no target slot) and persisted`);
    }
    return result.persist;
}
exports.persistTauchpumpeWhResetMigrationIfNeeded = persistTauchpumpeWhResetMigrationIfNeeded;
