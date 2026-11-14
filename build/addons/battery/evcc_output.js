"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVCC_OUTPUT_INITIAL = exports.EVCC_MODE_KEEPALIVE_MS = void 0;
exports.decideEvccBatteryMode = decideEvccBatteryMode;
exports.planEvccOutputStep = planEvccOutputStep;
exports.writeEvccBatteryMode = writeEvccBatteryMode;
const device_write_1 = require("../../device_write");
/** Erneuerung deutlich unter dem 60-s-Auto-Reset von evcc. */
exports.EVCC_MODE_KEEPALIVE_MS = 25_000;
function decideEvccBatteryMode(input) {
    if (input.externalAuthority) {
        return { mode: null, reasonDe: "evcc/Tibber steuert die Batterie selbst — EMS schreibt nichts." };
    }
    const action = input.intent.action;
    if (action === "grid_charge" || (action === "charge" && input.intent.energySource === "grid")) {
        return { mode: "charge", reasonDe: "Geplantes Netzladen — evcc-Modus „laden“." };
    }
    if (action === "hold" || action === "protect_reserve") {
        return { mode: "hold", reasonDe: "Batterie soll gehalten werden — evcc-Modus „halten“." };
    }
    return { mode: null, reasonDe: "Normalbetrieb — EMS schreibt nichts, evcc und Batterie laufen im Eigenverbrauch." };
}
exports.EVCC_OUTPUT_INITIAL = { lastWrittenMode: null, lastWriteMs: 0 };
/** Reine Ablaufentscheidung: Änderung sofort, gleicher Modus nur als Keepalive, Freigabe einmalig explizit. */
function planEvccOutputStep(desired, state, nowMs) {
    if (desired === null) {
        if (state.lastWrittenMode !== null && state.lastWrittenMode !== "normal") {
            return { write: "normal", next: { lastWrittenMode: "normal", lastWriteMs: nowMs } };
        }
        return { write: null, next: state };
    }
    if (state.lastWrittenMode !== desired || nowMs - state.lastWriteMs >= exports.EVCC_MODE_KEEPALIVE_MS) {
        return { write: desired, next: { lastWrittenMode: desired, lastWriteMs: nowMs } };
    }
    return { write: null, next: state };
}
async function writeEvccBatteryMode(host, params) {
    if (!params.stateId.trim())
        return { written: false, simulated: false, rejectCode: "missing_mapping" };
    if (!params.live) {
        host.log.debug(`battery evcc dryrun would_write ${params.mode} → ${params.stateId} (${params.reason})`);
        return { written: false, simulated: true, rejectCode: null };
    }
    try {
        // force: der Modus ist kurzlebig; der gelesene Zustand kann nach dem Auto-Reset veraltet sein.
        const r = await (0, device_write_1.writeForeignIfChanged)(host, {
            stateId: params.stateId,
            value: params.mode,
            reason: `battery evcc mode: ${params.reason}`,
            force: true,
        });
        if (r.blocked)
            return { written: false, simulated: false, rejectCode: r.blockReason ?? "blocked" };
        return { written: r.written, simulated: false, rejectCode: null };
    }
    catch (e) {
        host.log.warn(`battery evcc mode write failed ${params.stateId}: ${String(e)}`);
        return { written: false, simulated: false, rejectCode: "write_failed" };
    }
}
