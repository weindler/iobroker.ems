"use strict";
/**
 * Climate STOP-Intent / Retry-Kampagne — Generation gegen stale OFF-Writes.
 *
 * Es gibt keinen zeitgesteuerten Hintergrund-Retry-Timer. „retry stop“ bedeutet:
 * aktueller Tick will STOP und lastStopAtMs ist gesetzt.
 *
 * Stale-Schutz: eine STOP-Kampagne aus einer älteren Desired-Generation darf
 * nicht mehr schreiben, wenn die aktuelle authoritative Entscheidung ON/HOLD ist.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideStopWrite = exports.clearStopIntentAfterStart = exports.advanceCoolingDesired = exports.ensureStopIntentFields = exports.resolveCoolingDesired = exports.plannerCoolingBudgetOn = void 0;
function plannerCoolingBudgetOn(dailyPlan) {
    return (dailyPlan.useDailyPlan &&
        dailyPlan.allocatedPowerW !== null &&
        Number.isFinite(dailyPlan.allocatedPowerW) &&
        dailyPlan.allocatedPowerW > 0);
}
exports.plannerCoolingBudgetOn = plannerCoolingBudgetOn;
/**
 * @deprecated Engine nutzt computeAcCoolingDesired. Bleibt für Stop-Intent-Tests.
 * Desired folgt Permission (eine Authority) — hold wenn FB on und kein allowStop.
 */
function resolveCoolingDesired(input) {
    const { permission, fsm, dailyPlan, feedbackOn } = input;
    if (permission.allowStop)
        return "off";
    if (permission.allowStart)
        return "on";
    if (feedbackOn && !fsm.demandStop && (plannerCoolingBudgetOn(dailyPlan) || !dailyPlan.useDailyPlan)) {
        return "hold";
    }
    /** Fehlender NOW-Eintrag (allocationStatus none) ist kein OFF — halten. */
    if (feedbackOn && !fsm.demandStop && dailyPlan.useDailyPlan && dailyPlan.allocationStatus === "none") {
        return "hold";
    }
    return "idle";
}
exports.resolveCoolingDesired = resolveCoolingDesired;
function ensureStopIntentFields(up) {
    if (typeof up.commandGeneration !== "number" || !Number.isFinite(up.commandGeneration)) {
        up.commandGeneration = 0;
    }
    if (up.stopArmedGeneration !== null && typeof up.stopArmedGeneration !== "number") {
        up.stopArmedGeneration = null;
    }
    if (up.lastDesired == null) {
        up.lastDesired = null;
    }
}
exports.ensureStopIntentFields = ensureStopIntentFields;
/** Desired-Wechsel erhöht die Kommando-Generation; ON/HOLD invalidiert STOP-Kampagnen. */
function advanceCoolingDesired(up, desired) {
    ensureStopIntentFields(up);
    let generationBumped = false;
    let stopCleared = false;
    if (up.lastDesired !== desired) {
        up.commandGeneration += 1;
        up.lastDesired = desired;
        generationBumped = true;
    }
    if (desired === "on" || desired === "hold") {
        if (up.stopArmedGeneration != null) {
            up.stopArmedGeneration = null;
            stopCleared = true;
        }
    }
    return { generationBumped, stopCleared };
}
exports.advanceCoolingDesired = advanceCoolingDesired;
/** Nach erfolgreichem START: STOP-Kampagne der Vorperiode verwerfen. */
function clearStopIntentAfterStart(up) {
    ensureStopIntentFields(up);
    up.stopArmedGeneration = null;
    /** Alte Stop-Timestamps dürfen keinen „Retry“-Schein gegen den neuen Start erzeugen. */
    up.lastStopAtMs = null;
}
exports.clearStopIntentAfterStart = clearStopIntentAfterStart;
/**
 * Entscheidet, ob ein Stop-Write ausgeführt werden darf.
 * I1: nur bei aktuellem Desired OFF.
 * I2/I3: STOP-Kampagne muss zur aktuellen commandGeneration gehören.
 */
function decideStopWrite(input) {
    const { up, desired, feedbackOn, stopRetryReady } = input;
    ensureStopIntentFields(up);
    if (!feedbackOn) {
        up.stopArmedGeneration = null;
        return { action: "none", reasonDe: "feedback already off" };
    }
    if (desired === "on" || desired === "hold") {
        const hadArmed = up.stopArmedGeneration != null;
        up.stopArmedGeneration = null;
        if (hadArmed) {
            return {
                action: "cancel_stale",
                reasonDe: "stop retry cancelled — current planner intent is ON",
            };
        }
        return { action: "none", reasonDe: "desired on/hold — no stop" };
    }
    if (desired !== "off") {
        up.stopArmedGeneration = null;
        return { action: "none", reasonDe: "desired not off" };
    }
    /** Stale: Kampagne aus älterer Generation (z. B. nach ON und zurück). */
    if (up.stopArmedGeneration != null && up.stopArmedGeneration !== up.commandGeneration) {
        up.stopArmedGeneration = null;
        return {
            action: "cancel_stale",
            reasonDe: "stop retry cancelled — stop intent generation superseded",
        };
    }
    if (up.stopArmedGeneration == null) {
        up.stopArmedGeneration = up.commandGeneration;
    }
    if (!stopRetryReady) {
        return { action: "wait_retry", reasonDe: "stop retry cooldown active" };
    }
    const isRetry = input.lastStopAtMs != null;
    return {
        action: "execute_stop",
        reasonDe: isRetry ? "stop retry — current planner intent still OFF" : "stop — current planner intent OFF",
        isRetry,
    };
}
exports.decideStopWrite = decideStopWrite;
