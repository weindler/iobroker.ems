"use strict";
/**
 * Pfadspezifische Erfahrung η = spätere Entladung / eindeutige Ladung.
 * Kein Tages-charge/discharge-Quotient, keine Jahreswerte als operative η.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionsFromChargeSlots = exports.etaForPath = exports.learnEtaPaths = void 0;
const constants_1 = require("./constants");
const types_1 = require("./types");
function median(values) {
    if (values.length === 0)
        return null;
    const s = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function pathFromSessions(sessions, source) {
    const etas = [];
    for (const s of sessions) {
        if (s.source !== source)
            continue;
        if (!(s.chargeKwh >= constants_1.MIN_ETA_ENERGY_KWH) || !(s.dischargeKwh >= 0))
            continue;
        const eta = s.dischargeKwh / s.chargeKwh;
        if (!Number.isFinite(eta))
            continue;
        if (eta < constants_1.ETA_PLAUSIBLE_MIN || eta > constants_1.ETA_PLAUSIBLE_MAX)
            continue;
        etas.push(eta);
    }
    const m = median(etas);
    return {
        eta: m,
        usable: m != null && etas.length >= constants_1.MIN_ETA_SESSIONS,
        count: etas.length,
    };
}
function learnEtaPaths(sessions) {
    const pv = pathFromSessions(sessions, "pv");
    const grid = pathFromSessions(sessions, "grid");
    if (!pv.usable && !grid.usable) {
        return {
            ...(0, types_1.emptyEtaPath)("Keine ausreichend eindeutigen Energiepfade — 92 %-Fallback."),
            pvSessionCount: pv.count,
            gridSessionCount: grid.count,
            etaPvPath: pv.eta,
            etaGridPath: grid.eta,
        };
    }
    return {
        etaPvPath: pv.eta,
        etaGridPath: grid.eta,
        etaPvUsable: pv.usable,
        etaGridUsable: grid.usable,
        pvSessionCount: pv.count,
        gridSessionCount: grid.count,
        reasonDe: `Pfad-η PV ${pv.usable ? "usable" : "Fallback"} (${pv.count}), Netz ${grid.usable ? "usable" : "Fallback"} (${grid.count}).`,
    };
}
exports.learnEtaPaths = learnEtaPaths;
function etaForPath(learning, path) {
    if (path === "pv")
        return learning.etaPvUsable && learning.etaPvPath != null ? learning.etaPvPath : constants_1.ETA_PATH_FALLBACK;
    return learning.etaGridUsable && learning.etaGridPath != null ? learning.etaGridPath : constants_1.ETA_PATH_FALLBACK;
}
exports.etaForPath = etaForPath;
/**
 * Aus Slot-Reihen eindeutige Lade→Entlade-Sessions ableiten.
 * mixed/unknown unterbrechen den Pfad (keine Zuordnung).
 */
function sessionsFromChargeSlots(input) {
    const n = Math.min(input.chargedKwh.length, input.dischargedKwh.length, input.source.length);
    const out = [];
    let i = 0;
    while (i < n) {
        const src = input.source[i];
        const ch = input.chargedKwh[i];
        if ((src !== "pv" && src !== "grid") || ch == null || !(ch > 0)) {
            i += 1;
            continue;
        }
        const source = src;
        let charge = 0;
        while (i < n) {
            const s = input.source[i];
            const c = input.chargedKwh[i];
            const d = input.dischargedKwh[i];
            if (c != null && c > 0) {
                if (s !== source)
                    break;
                charge += c;
                i += 1;
                continue;
            }
            if (d != null && d > 0)
                break;
            i += 1;
        }
        let discharge = 0;
        while (i < n) {
            const s = input.source[i];
            const c = input.chargedKwh[i];
            const d = input.dischargedKwh[i];
            if (c != null && c > 0)
                break;
            if (s === "pv" || s === "grid" || s === "mixed") {
                /* Herkunft während Entladung irrelevant; mixed-Ladung wäre oben schon break. */
            }
            if (d != null && d > 0)
                discharge += d;
            i += 1;
        }
        if (charge >= constants_1.MIN_ETA_ENERGY_KWH && discharge > 0) {
            out.push({ source, chargeKwh: charge, dischargeKwh: discharge });
        }
    }
    return out;
}
exports.sessionsFromChargeSlots = sessionsFromChargeSlots;
