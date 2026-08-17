"use strict";
/**
 * Einzige Authority: Hausbatterie-Hold wegen einer realen EV-Aktion.
 *
 * Kein nachgelagerter Pfad (Planner-Constraints, Grid-Balance, VIS) darf aus
 * EVCC-Rohsignalen (z. B. mode=now bei getrenntem Fahrzeug) eine EV-Aktion
 * oder einen Batterie-Hold rekonstruieren.
 *
 * Hold nur wenn das Fahrzeug verbunden ist UND eine nachweisbare EV-Ladung
 * bzw. eine explizite externe Hoheit (Tibber Rewards) vorliegt.
 * Leftover EVCC now / Boost ohne Verbindung oder ohne Ladung ist kein Hold.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveWallboxBatteryHold = exports.interpretExternalVehicleCharge = exports.isEvActuallyCharging = exports.isEvVehiclePresent = exports.EV_CHARGE_ACTION_MIN_W = void 0;
exports.EV_CHARGE_ACTION_MIN_W = 50;
function isEvVehiclePresent(connected) {
    return connected === true;
}
exports.isEvVehiclePresent = isEvVehiclePresent;
function isEvActuallyCharging(input) {
    if (input.charging === true)
        return true;
    const p = input.chargePowerW;
    const min = input.minW ?? exports.EV_CHARGE_ACTION_MIN_W;
    return p != null && Number.isFinite(p) && p >= min;
}
exports.isEvActuallyCharging = isEvActuallyCharging;
/** Interpretiert HA-/Fremd-Ladestatus konservativ (unbekannt → nicht aktiv). */
function interpretExternalVehicleCharge(raw) {
    if (raw === null || raw === undefined)
        return false;
    if (typeof raw === "boolean")
        return raw;
    const s = String(raw).trim();
    if (!s)
        return false;
    const lower = s.toLowerCase();
    if (lower === "complete" || lower === "completed" || lower === "ready")
        return false;
    if (lower === "not_ready" || lower === "disconnected" || lower === "idle")
        return false;
    if (lower === "false" || lower === "0" || lower === "off" || lower === "no")
        return false;
    if (lower === "true" || lower === "1" || lower === "on" || lower === "yes")
        return true;
    if (lower === "charging" || lower === "chargingac" || lower === "chargingdc")
        return true;
    if (lower === "in_progress" || lower === "in-progress" || lower === "inprogress")
        return true;
    // Enthält "charg", aber nicht "not" (z. B. "not charging" / NOT_READY).
    if (lower.includes("charg") && !lower.includes("not"))
        return true;
    return false;
}
exports.interpretExternalVehicleCharge = interpretExternalVehicleCharge;
/** PV-/Überschuss-Modi: HA „Charging“ ist hier normales EVCC-Laden → kein External-Hold. */
function isPvSurplusLoadpointMode(mode) {
    return mode === "pv" || mode === "minpv" || mode === "min+pv" || mode === "solar";
}
function normalizeLoadpointMode(raw) {
    return String(raw ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
}
function resolveWallboxBatteryHold(input) {
    const none = (reasonDe) => ({
        hold: false,
        boostActive: false,
        externalActive: false,
        tibberRewardsActive: false,
        reasonDe,
    });
    if (!isEvVehiclePresent(input.vehicleConnected)) {
        return none("Kein Fahrzeug verbunden — kein EV-Batterie-Hold (EVCC-Modus allein ist keine EV-Aktion).");
    }
    const mode = normalizeLoadpointMode(input.loadpointMode);
    const actuallyCharging = isEvActuallyCharging({
        charging: input.charging,
        chargePowerW: input.chargePowerW,
    });
    const boostMode = input.batteryBoost === true || mode === "now";
    const boostActive = boostMode && actuallyCharging;
    const externalRawActive = interpretExternalVehicleCharge(input.externalVehicleChargeRaw);
    const externalActive = externalRawActive && actuallyCharging && !isPvSurplusLoadpointMode(mode);
    const tibberRewardsActive = input.tibberGridRewardsActive === true;
    const hold = boostActive || externalActive || tibberRewardsActive;
    const parts = [];
    if (boostActive) {
        if (input.batteryBoost === true && mode === "now") {
            parts.push("EVCC Boost/Sofortladen (batteryBoost + mode=now, Fahrzeug lädt)");
        }
        else if (input.batteryBoost === true) {
            parts.push("EVCC batteryBoost aktiv (Fahrzeug lädt)");
        }
        else {
            parts.push("EVCC Loadpoint-Modus now bei verbundener Ladung");
        }
    }
    if (externalActive)
        parts.push("externes Fahrzeugladen aktiv");
    if (tibberRewardsActive)
        parts.push("Tibber Grid Rewards aktiv");
    return {
        hold,
        boostActive,
        externalActive,
        tibberRewardsActive,
        reasonDe: hold
            ? `Hausbatterie-Hold für EV-Laden: ${parts.join(", ")}.`
            : "Kein Wallbox-Batterie-Hold (kein verbundenes Laden / keine externe Hoheit).",
    };
}
exports.resolveWallboxBatteryHold = resolveWallboxBatteryHold;
