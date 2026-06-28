"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSafeDefaultAction = exports.isChargingAction = exports.deviceIntentFromResolved = void 0;
/**
 * Übersetzt den herstellerneutralen, aufgelösten Batterie-Intent in einen
 * geräteorientierten Intent. `discharge` wird hier strukturiert abgewiesen
 * (keine bestätigte Entladesteuerung in dieser Version).
 */
function deviceIntentFromResolved(resolved, options = {}) {
    const source = options.source ?? "ems_intent";
    const now = options.now ?? new Date();
    const op = resolved.operating_request.value;
    const targetSoc = resolved.target_soc_pct.status === "valid" ? resolved.target_soc_pct.value : null;
    const gridCharge = resolved.grid_charge_request.value;
    const topOff = resolved.top_off_requested.status === "valid" && resolved.top_off_requested.value === true;
    if (op === "discharge") {
        return { intent: null, rejected: "discharge_not_supported" };
    }
    let action;
    let energySource = "any";
    if (topOff) {
        action = "topoff";
        energySource = "any";
    }
    else if (op === "charge") {
        action = gridCharge === "allow" ? "grid_charge" : "charge";
        energySource = gridCharge === "allow" ? "grid" : "pv";
    }
    else if (gridCharge === "allow") {
        action = "grid_charge";
        energySource = "grid";
    }
    else if (op === "hold") {
        action = "hold";
    }
    else if (op === "protect") {
        action = "protect_reserve";
    }
    else if (op === "off" || op === "auto" || op === "unknown") {
        action = "self_consumption";
    }
    else {
        action = "self_consumption";
    }
    const intent = {
        requestId: resolved.target.id
            ? `${resolved.domain}-${resolved.revision}`
            : `battery-${resolved.revision}`,
        action,
        targetSocPct: targetSoc,
        maxChargeW: null,
        maxDischargeW: null,
        energySource,
        validFrom: null,
        validUntil: resolved.manual_override.active ? resolved.manual_override.valid_until ?? null : null,
        issuedAt: resolved.resolved_at,
        reason: `op=${op} grid=${gridCharge} topoff=${topOff}`,
        source,
    };
    void now;
    return { intent, rejected: null };
}
exports.deviceIntentFromResolved = deviceIntentFromResolved;
/** Aktionen, die einen aktiven Ladevorgang (Modus 1) bedeuten. */
function isChargingAction(action) {
    return action === "charge" || action === "grid_charge" || action === "topoff";
}
exports.isChargingAction = isChargingAction;
/** Aktionen, die den sicheren Grundzustand (Self Consumption / Modus 2) bedeuten. */
function isSafeDefaultAction(action) {
    return action === "self_consumption" || action === "safe_default" || action === "protect_reserve";
}
exports.isSafeDefaultAction = isSafeDefaultAction;
