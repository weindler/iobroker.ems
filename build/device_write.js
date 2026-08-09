"use strict";
/** Read-before-write: kein Geräte-Write wenn Zielwert bereits aktiv ist. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeForeignIfChanged = exports.deviceValuesMatch = exports.normalizeDeviceValue = void 0;
const barrier_1 = require("./restore/barrier");
function normalizeDeviceValue(val) {
    if (val === null || val === undefined || val === "") {
        return null;
    }
    if (typeof val === "boolean" || typeof val === "number") {
        return val;
    }
    if (typeof val === "string") {
        const s = val.trim().toLowerCase();
        if (["true", "1", "on", "yes", "ja"].includes(s)) {
            return true;
        }
        if (["false", "0", "off", "no", "nein"].includes(s)) {
            return false;
        }
        const n = parseFloat(val.replace(",", "."));
        if (Number.isFinite(n)) {
            return n;
        }
        return val.trim();
    }
    return val;
}
exports.normalizeDeviceValue = normalizeDeviceValue;
function deviceValuesMatch(current, requested, options = {}) {
    const cur = normalizeDeviceValue(current);
    const req = normalizeDeviceValue(requested);
    if (cur === req) {
        return true;
    }
    if (cur === null || req === null) {
        return false;
    }
    if (typeof cur === "number" && typeof req === "number") {
        const tol = options.numericTolerance ?? 0;
        return Math.abs(cur - req) <= tol;
    }
    if (typeof cur === "boolean" && typeof req === "boolean") {
        return cur === req;
    }
    if (typeof cur === "boolean" && typeof req === "number") {
        return (cur && req !== 0) || (!cur && req === 0);
    }
    if (typeof cur === "number" && typeof req === "boolean") {
        return (req && cur !== 0) || (!req && cur === 0);
    }
    return String(cur) === String(req);
}
exports.deviceValuesMatch = deviceValuesMatch;
/**
 * Liest den aktuellen Geräte-State und schreibt nur bei Abweichung.
 * skipped=true ohne blocked bedeutet: Ziel bereits erreicht, kein Bus-Traffic nötig.
 */
async function writeForeignIfChanged(host, params) {
    const gate = (0, barrier_1.assertDeviceActionAllowed)();
    if (!gate.ok) {
        return {
            written: false,
            skipped: true,
            blocked: true,
            blockReason: gate.reason,
            currentValue: null,
        };
    }
    if (!params.stateId.trim()) {
        return { written: false, skipped: false, currentValue: null };
    }
    let current = null;
    if (!params.force) {
        try {
            const st = await host.getForeignStateAsync(params.stateId);
            current = st?.val ?? null;
            if (deviceValuesMatch(current, params.value, { numericTolerance: params.numericTolerance })) {
                host.log?.debug?.(`device write skipped (already at target) ${params.stateId}=${String(params.value)} (${params.reason})`);
                return { written: false, skipped: true, currentValue: current };
            }
        }
        catch {
            // Lesefehler — Write-Versuch trotzdem (Gerät evtl. offline)
        }
    }
    await host.setForeignStateAsync(params.stateId, { val: params.value, ack: false });
    return { written: true, skipped: false, currentValue: current };
}
exports.writeForeignIfChanged = writeForeignIfChanged;
