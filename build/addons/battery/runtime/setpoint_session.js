"use strict";
/**
 * Einheitlicher Batterie-Setpoint-Release (alle EMS-Pfade, die control.charge > 0 schreiben).
 *
 * Vertrag:
 *   eigener erfolgreicher Leistungs-Write > 0 → Ownership → reguläres Aktionsende
 *   → genau ein Release-Write 0 W → Ownership frei.
 *
 * Kein 0-W-Write gegen eine neue Authority (Hold / External / Restore-Fault /
 * höhere Batterieaktion) — Ownership wird nur abgegeben.
 *
 * Ohne Ownership (z. B. Adapterrestart mit altem Geräte-Setpoint) kein Blind-0.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.consumeFailsafeSetpointTakeover = exports.markFailsafeSetpointTakeover = exports.resetBatterySetpointSession = exports.setBatterySetpointSession = exports.getBatterySetpointSession = exports.applyHandover = exports.applyZeroRelease = exports.markReleasePending = exports.decideSetpointRelease = exports.notePositiveSetpointWrite = exports.resolveBatterySetpointHandover = exports.setpointOwnerFromAction = exports.emptySetpointSession = void 0;
function emptySetpointSession() {
    return {
        owner: "none",
        setpointW: 0,
        wrotePositive: false,
        wroteLive: false,
        releasePending: false,
        releaseReason: "",
        lastReleaseAt: null,
    };
}
exports.emptySetpointSession = emptySetpointSession;
function setpointOwnerFromAction(action) {
    if (action === "grid_balance")
        return "grid_balance";
    if (action === "grid_charge")
        return "grid_charge";
    if (action === "charge" || action === "topoff")
        return "planned_charge";
    return "none";
}
exports.setpointOwnerFromAction = setpointOwnerFromAction;
function resolveBatterySetpointHandover(input) {
    if (input.restoreOrFault)
        return "restore_fault";
    if (input.external)
        return "external";
    if (input.hold)
        return "hold";
    if (input.higherPriority)
        return "higher_priority";
    return "none";
}
exports.resolveBatterySetpointHandover = resolveBatterySetpointHandover;
/** Nur nach akzeptiertem Write (executed / written / simulated) mit powerW > 0. */
function notePositiveSetpointWrite(session, owner, powerW, live) {
    if (owner === "none" || !(powerW > 0) || !Number.isFinite(powerW))
        return session;
    return {
        ...session,
        owner,
        setpointW: Math.round(powerW),
        wrotePositive: true,
        wroteLive: live || session.wroteLive,
        releasePending: false,
        releaseReason: "",
    };
}
exports.notePositiveSetpointWrite = notePositiveSetpointWrite;
function decideSetpointRelease(input) {
    const owns = input.session.owner !== "none" && input.session.wrotePositive;
    if (!owns) {
        return { shouldWriteZero: false, dropOwnership: false, reason: "no_ownership" };
    }
    if (input.handover !== "none") {
        return { shouldWriteZero: false, dropOwnership: true, reason: `handover_${input.handover}` };
    }
    if (!input.regularEnd) {
        return { shouldWriteZero: false, dropOwnership: false, reason: "" };
    }
    if (input.session.setpointW <= 0) {
        return { shouldWriteZero: false, dropOwnership: true, reason: "already_released" };
    }
    return { shouldWriteZero: true, dropOwnership: true, reason: "regular_end" };
}
exports.decideSetpointRelease = decideSetpointRelease;
function markReleasePending(session, reason) {
    if (session.owner === "none" || !session.wrotePositive)
        return session;
    return { ...session, releasePending: true, releaseReason: reason };
}
exports.markReleasePending = markReleasePending;
function applyZeroRelease(session, nowIso, reason) {
    return {
        owner: "none",
        setpointW: 0,
        wrotePositive: false,
        wroteLive: false,
        releasePending: false,
        releaseReason: reason,
        lastReleaseAt: nowIso,
    };
}
exports.applyZeroRelease = applyZeroRelease;
/** Authority-Übergabe: kein 0-Write, Ownership frei. */
function applyHandover(session, reason) {
    return {
        owner: "none",
        setpointW: 0,
        wrotePositive: false,
        wroteLive: false,
        releasePending: false,
        releaseReason: reason,
        lastReleaseAt: session.lastReleaseAt,
    };
}
exports.applyHandover = applyHandover;
let held = emptySetpointSession();
let failsafeTookOver = false;
function getBatterySetpointSession() {
    return held;
}
exports.getBatterySetpointSession = getBatterySetpointSession;
function setBatterySetpointSession(next) {
    held = next;
}
exports.setBatterySetpointSession = setBatterySetpointSession;
function resetBatterySetpointSession() {
    held = emptySetpointSession();
    failsafeTookOver = false;
}
exports.resetBatterySetpointSession = resetBatterySetpointSession;
/** Failsafe hat 0 W geschrieben — FSM/GB dürfen nicht gegen diese Restore-Authority aufräumen. */
function markFailsafeSetpointTakeover(nowIso) {
    held = applyZeroRelease(held, nowIso, "failsafe");
    failsafeTookOver = true;
}
exports.markFailsafeSetpointTakeover = markFailsafeSetpointTakeover;
function consumeFailsafeSetpointTakeover() {
    const v = failsafeTookOver;
    failsafeTookOver = false;
    return v;
}
exports.consumeFailsafeSetpointTakeover = consumeFailsafeSetpointTakeover;
