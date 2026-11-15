"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BALANCE_MIN_SOC_COVERAGE = exports.BALANCE_MIN_DISCHARGED_KWH = exports.BALANCE_MIN_CHARGED_KWH = exports.BALANCE_MIN_DAYS = void 0;
exports.etaFromBalance = etaFromBalance;
/**
 * Wirkungsgrad aus der Gesamtbilanz mehrerer zusammenhängender Tage:
 *
 *   η = entladene Energie / (geladene Energie − Zunahme des Speicherinhalts)
 *
 * Tagesweise Lade→Entlade-Sitzungen taugen dafür nicht: abends/nachts wird nach Mitternacht
 * entladen, was zu einem anderen Tag gehört. Die Bilanz über mehrere Tage umgeht das, weil
 * der Speicherinhalt am Anfang und Ende über den Ladestand (SOC) berücksichtigt wird.
 */
const constants_1 = require("./constants");
exports.BALANCE_MIN_DAYS = 4;
exports.BALANCE_MIN_CHARGED_KWH = 12;
exports.BALANCE_MIN_DISCHARGED_KWH = 8;
exports.BALANCE_MIN_SOC_COVERAGE = 0.5;
function nextKey(key) {
    return new Date(Date.parse(`${key}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
function none(reasonDe, days = 0) {
    return { eta: null, days, chargedKwh: 0, dischargedKwh: 0, storedChangeKwh: 0, reasonDe };
}
/** Längste zusammenhängende, vollständige Tagesfolge, die am neuesten Tag endet. */
function etaFromBalance(allDays, capacityKwh) {
    if (capacityKwh === null || !(capacityKwh > 0))
        return none("Batteriekapazität fehlt — keine Bilanz möglich.");
    const sorted = allDays.slice().sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const usable = (d) => d.chargedKwh !== null &&
        d.dischargedKwh !== null &&
        d.socFirstPct !== null &&
        d.socLastPct !== null &&
        d.socCoverage >= exports.BALANCE_MIN_SOC_COVERAGE;
    const run = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
        const d = sorted[i];
        if (!usable(d))
            break;
        const later = run[0];
        if (later && nextKey(d.dateKey) !== later.dateKey)
            break;
        run.unshift(d);
    }
    if (run.length < exports.BALANCE_MIN_DAYS) {
        return none(`Bilanz: erst ${run.length} lückenlose Tage mit Batteriedaten (mind. ${exports.BALANCE_MIN_DAYS}).`, run.length);
    }
    const charged = run.reduce((s, d) => s + (d.chargedKwh ?? 0), 0);
    const discharged = run.reduce((s, d) => s + (d.dischargedKwh ?? 0), 0);
    const storedChange = ((run[run.length - 1].socLastPct - run[0].socFirstPct) / 100) * capacityKwh;
    const base = charged - storedChange;
    if (charged < exports.BALANCE_MIN_CHARGED_KWH || discharged < exports.BALANCE_MIN_DISCHARGED_KWH || base < exports.BALANCE_MIN_DISCHARGED_KWH) {
        return { ...none(`Bilanz: zu wenig Energie (${charged.toFixed(1)} kWh geladen, ${discharged.toFixed(1)} kWh entladen).`, run.length), chargedKwh: charged, dischargedKwh: discharged, storedChangeKwh: storedChange };
    }
    const eta = discharged / base;
    const r = { days: run.length, chargedKwh: charged, dischargedKwh: discharged, storedChangeKwh: storedChange };
    if (!Number.isFinite(eta) || eta < constants_1.ETA_PLAUSIBLE_MIN || eta > constants_1.ETA_PLAUSIBLE_MAX) {
        return { ...r, eta: null, reasonDe: `Bilanz ${run.length} Tage ergab ${(eta * 100).toFixed(0)} % — unplausibel, verworfen.` };
    }
    return {
        ...r,
        eta: Math.round(eta * 1000) / 1000,
        reasonDe: `Aus der Gesamtbilanz der letzten ${run.length} Tage: ${discharged.toFixed(1)} kWh entladen bei ${charged.toFixed(1)} kWh geladen (Speicherinhalt ${storedChange >= 0 ? "+" : ""}${storedChange.toFixed(1)} kWh).`,
    };
}
