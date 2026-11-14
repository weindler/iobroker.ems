"use strict";
/**
 * Batterie-Setpoint-Release, typisiert nach Charge- vs. Discharge-Kanal.
 *
 * Grid Charge / geplante Ladung: control.charge > 0 → Ownership kind=charge
 *   → reguläres Ende → genau ein charge=0.
 *
 * Grid Balance: control.discharge > 0 → Ownership kind=discharge
 *   → reguläres Ende → genau ein discharge=0.
 *
 * Kein 0-W-Write gegen eine neue Authority (Hold / External / Restore-Fault /
 * höhere Batterieaktion) — Ownership wird nur abgegeben.
 *
 * Ohne Ownership (z. B. Adapterrestart mit altem Geräte-Setpoint) kein Blind-0.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setpointKindFromOwner = setpointKindFromOwner;
exports.emptySetpointSession = emptySetpointSession;
exports.setpointOwnerFromAction = setpointOwnerFromAction;
exports.resolveBatterySetpointHandover = resolveBatterySetpointHandover;
exports.notePositiveSetpointWrite = notePositiveSetpointWrite;
exports.decideSetpointRelease = decideSetpointRelease;
exports.markReleasePending = markReleasePending;
exports.applyZeroRelease = applyZeroRelease;
exports.applyHandover = applyHandover;
exports.getBatterySetpointSession = getBatterySetpointSession;
exports.setBatterySetpointSession = setBatterySetpointSession;
exports.resetBatterySetpointSession = resetBatterySetpointSession;
exports.markFailsafeSetpointTakeover = markFailsafeSetpointTakeover;
exports.consumeFailsafeSetpointTakeover = consumeFailsafeSetpointTakeover;
function setpointKindFromOwner(owner) {
    if (owner === "grid_balance")
        return "discharge";
    if (owner === "grid_charge" || owner === "planned_charge")
        return "charge";
    return "none";
}
function emptySetpointSession() {
    return {
        owner: "none",
        kind: "none",
        setpointW: 0,
        wrotePositive: false,
        wroteLive: false,
        releasePending: false,
        releaseReason: "",
        lastReleaseAt: null,
    };
}
function setpointOwnerFromAction(action) {
    if (action === "grid_balance")
        return "grid_balance";
    if (action === "grid_charge")
        return "grid_charge";
    if (action === "charge" || action === "topoff")
        return "planned_charge";
    return "none";
}
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
/** Nur nach akzeptiertem Write (executed / written / simulated) mit powerW > 0. */
function notePositiveSetpointWrite(session, owner, powerW, live) {
    if (owner === "none" || !(powerW > 0) || !Number.isFinite(powerW))
        return session;
    const kind = setpointKindFromOwner(owner);
    return {
        ...session,
        owner,
        kind,
        setpointW: Math.round(powerW),
        wrotePositive: true,
        wroteLive: live || session.wroteLive,
        releasePending: false,
        releaseReason: "",
    };
}
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
function markReleasePending(session, reason) {
    if (session.owner === "none" || !session.wrotePositive)
        return session;
    return { ...session, releasePending: true, releaseReason: reason };
}
function applyZeroRelease(session, nowIso, reason) {
    return {
        owner: "none",
        kind: "none",
        setpointW: 0,
        wrotePositive: false,
        wroteLive: false,
        releasePending: false,
        releaseReason: reason,
        lastReleaseAt: nowIso,
    };
}
/** Authority-Übergabe: kein 0-Write, Ownership frei. */
function applyHandover(session, reason) {
    return {
        owner: "none",
        kind: "none",
        setpointW: 0,
        wrotePositive: false,
        wroteLive: false,
        releasePending: false,
        releaseReason: reason,
        lastReleaseAt: session.lastReleaseAt,
    };
}
let held = emptySetpointSession();
let failsafeTookOver = false;
function getBatterySetpointSession() {
    return held;
}
function setBatterySetpointSession(next) {
    held = next;
}
function resetBatterySetpointSession() {
    held = emptySetpointSession();
    failsafeTookOver = false;
}
/** Failsafe hat 0 W geschrieben — FSM/GB dürfen nicht gegen diese Restore-Authority aufräumen. */
function markFailsafeSetpointTakeover(nowIso) {
    held = applyZeroRelease(held, nowIso, "failsafe");
    failsafeTookOver = true;
}
function consumeFailsafeSetpointTakeover() {
    const v = failsafeTookOver;
    failsafeTookOver = false;
    return v;
}
