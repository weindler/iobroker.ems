"use strict";
/**
 * PHASE 5 — Shadow-Lastmodell.
 *
 * Die Shadow-Welt darf NICHT die reale Gesamt-Hauslast übernehmen und anschließend
 * steuerbare Verbraucher noch einmal drauflegen (Doppelzählung).
 *
 *   exogene Grundlast = reale Hauslast − reale steuerbare EMS-Verbraucher
 *   Weltlast          = exogene Grundlast + steuerbare Verbraucher DIESER Welt
 *
 * Steuerbar (EMS): Klima (Shared-Power, nie Indoor-Doppelt), Heizstab, EV.
 * Measured Consumers ohne EMS-Steuerung bleiben in der exogenen Last.
 *
 * Fehlende Komponenten werden nicht als 0 erfunden — sie werden nicht abgezogen.
 * Wenn die Summe der bekannten Steuerbaren die Hauslast übersteigt (Messinkonsistenz),
 * wird die exogene Last auf 0 geklemmt statt negativ zu werden.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitExogenousLoad = void 0;
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
function slotControllableKwh(day, i) {
    const climateShared = day.buckets.climateElecSharedKwh[i];
    const climateFallback = day.buckets.climateKwh[i];
    const climate = climateShared !== null ? climateShared : climateFallback;
    const immersion = day.buckets.immersionKwh[i];
    const ev = day.buckets.evChargedKwh[i];
    let sum = 0;
    let any = false;
    for (const v of [climate, immersion, ev]) {
        if (v === null || !Number.isFinite(v) || v < 0)
            continue;
        sum += v;
        any = true;
    }
    return any ? round3(sum) : null;
}
/**
 * Spaltet die reale Hauslast in exogene Grundlast und steuerbare EMS-Verbraucher.
 * Rein deterministisch, keine I/O, keine Future-Leakage (nur day_telemetry-Buckets).
 */
function splitExogenousLoad(day) {
    const n = day.slotCount;
    const exogenousKwh = new Array(n).fill(null);
    const controllableKwh = new Array(n).fill(null);
    const noEmsTotalLoadKwh = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        const house = day.buckets.houseTotalKwh[i];
        const ctrl = slotControllableKwh(day, i);
        controllableKwh[i] = ctrl;
        if (house === null || !Number.isFinite(house) || house < 0)
            continue;
        const exo = ctrl === null ? house : Math.max(0, house - ctrl);
        exogenousKwh[i] = round3(exo);
        /*
         * reference_no_ems: kein belastbares alternatives Zeitmodell für Klima/Heizstab/EV
         * → reale Steuerbare wieder addieren. Ergebnis = Hauslast (geclampt), nie Haus+extra.
         */
        noEmsTotalLoadKwh[i] = round3(exo + (ctrl ?? 0));
    }
    return { exogenousKwh, controllableKwh, noEmsTotalLoadKwh };
}
exports.splitExogenousLoad = splitExogenousLoad;
