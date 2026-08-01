"use strict";
/**
 * Hausbatterie-Hold für Wallbox/EV: nur bei Boost/Fast oder externem Fahrzeugladen
 * (oder explizit aktivem Tibber Grid Rewards Signal) — nicht bei MinPV/PV.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveWallboxBatteryHold = exports.interpretExternalVehicleCharge = void 0;
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
function resolveWallboxBatteryHold(input) {
    const mode = (input.loadpointMode ?? "").trim().toLowerCase();
    const boostActive = input.batteryBoost === true || mode === "now";
    // External nur wenn Fahrzeug lädt UND Mode das nicht als MinPV/PV erklärt (sonst False-Positive).
    // Tibber-während-MinPV braucht das explizite Rewards-Flag (vorbereitet).
    const externalRawActive = interpretExternalVehicleCharge(input.externalVehicleChargeRaw);
    const externalActive = externalRawActive && !isPvSurplusLoadpointMode(mode);
    const tibberRewardsActive = input.tibberGridRewardsActive === true;
    const hold = boostActive || externalActive || tibberRewardsActive;
    const parts = [];
    if (boostActive) {
        if (input.batteryBoost === true && mode === "now") {
            parts.push("EVCC Boost/Sofortladen (batteryBoost + mode=now)");
        }
        else if (input.batteryBoost === true) {
            parts.push("EVCC batteryBoost aktiv");
        }
        else {
            parts.push("EVCC Loadpoint-Modus now (Sofortladen)");
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
            : "Kein Wallbox-Batterie-Hold (MinPV/PV oder kein Boost/externes Laden).",
    };
}
exports.resolveWallboxBatteryHold = resolveWallboxBatteryHold;
