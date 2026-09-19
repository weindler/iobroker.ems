"use strict";
/**
 * Passive Battery-Energiequelle für Unified-Verbraucher (AC/Wallbox/IH).
 *
 * Kein Discharge-Write — nur Planungsannahme, ob die reale Batterie im
 * autonomen Self-Consumption-Betrieb passiv entladen kann.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePassiveBatteryEnergyForecastAvailable = exports.resolvePassiveBatteryEnergyAvailable = void 0;
/**
 * Nur Self-Consumption ohne Ownership/Hold gilt als verlässlich passive Quelle.
 * Unbekannter oder Manual-/Sonst-Modus → konservativ gesperrt.
 */
function resolvePassiveBatteryEnergyAvailable(input) {
    if (input.ownershipActive) {
        return {
            available: false,
            reasonDe: "Batterie unter EMS-Ownership — keine zugesicherte passive Entladung.",
            reasonCode: "passive_battery_ownership",
        };
    }
    if (input.batteryHoldActive === true) {
        return {
            available: false,
            reasonDe: "Batterie-Hold aktiv — keine zugesicherte passive Entladung.",
            reasonCode: "passive_battery_hold",
        };
    }
    if (input.operatingMode === null || !Number.isFinite(input.operatingMode)) {
        return {
            available: false,
            reasonDe: "Batterie-Betriebsart unbekannt — konservativ keine passive Energiequelle.",
            reasonCode: "passive_battery_mode_unknown",
        };
    }
    if (input.operatingMode === input.manualModeValue) {
        return {
            available: false,
            reasonDe: "Batterie im Manual-/Hold-Modus — keine verlässliche passive Entladung.",
            reasonCode: "passive_battery_manual",
        };
    }
    if (input.operatingMode === input.selfConsumptionModeValue) {
        return {
            available: true,
            reasonDe: "Batterie im Self-Consumption — SOC oberhalb Reserve passiv nutzbar.",
            reasonCode: "passive_battery_self_consumption",
        };
    }
    return {
        available: false,
        reasonDe: "Batterie-Betriebsart erlaubt keine zugesicherte passive Entladung.",
        reasonCode: "passive_battery_mode_other",
    };
}
exports.resolvePassiveBatteryEnergyAvailable = resolvePassiveBatteryEnergyAvailable;
/**
 * Reine Zukunftsannahme nach einem flüchtigen EMS-/EV-Hold. Die reale aktuelle
 * Verfügbarkeit bleibt davon unberührt. Nach eigener EMS-Ownership wird die von
 * EMS wiederhergestellte Self-Consumption-Betriebsart angenommen; ein ausdrücklicher
 * Benutzer-Hold bleibt dagegen auch im Forecast gesperrt.
 */
function resolvePassiveBatteryEnergyForecastAvailable(input) {
    /*
     * Die 72-h-Projektion beschreibt den Zustand nach der aktuellen Live-Steuerung.
     * Deshalb dürfen weder ein derzeitiges Manual/unknown aus der Gerätetelemetrie
     * noch Ownership/EVCC-Hold den ganzen Horizont einfrieren. Nur ein ausdrücklicher
     * Benutzer-Hold ist eine belastbare dauerhafte Zukunftsvorgabe.
     */
    return resolvePassiveBatteryEnergyAvailable({
        ...input,
        operatingMode: input.userHoldActive === true
            ? input.operatingMode
            : input.selfConsumptionModeValue,
        ownershipActive: false,
        batteryHoldActive: input.userHoldActive === true,
    });
}
exports.resolvePassiveBatteryEnergyForecastAvailable = resolvePassiveBatteryEnergyForecastAvailable;
