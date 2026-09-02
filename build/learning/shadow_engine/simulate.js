"use strict";
/**
 * PHASE 5 — Simulationskern: realer Tag + Gegenwelten (reference_no_ems, ems_without_ai).
 *
 * POINT-IN-TIME-REGEL: Diese Funktionen verwenden ausschließlich, was in day_telemetry für
 * den jeweiligen Tag tatsächlich aufgezeichnet wurde (reale Messwerte). Es fließt kein
 * heutiges Wissen, keine aktuelle Konfiguration rückwirkend und kein zukünftiger Tag ein.
 *
 * SHADOW-LASTMODELL: exogene Grundlast = reale Hauslast − steuerbare EMS-Verbraucher
 * (Klima Shared-Power / Heizstab / EV). Jede simulierte Welt addiert ihre eigenen
 * steuerbaren Verbraucher. Für reference_no_ems gibt es kein belastbares alternatives
 * Zeitmodell für Klima/Heizstab/EV — diese laufen daher zeitlich wie real gemessen,
 * die Batterie wird abweichend simuliert (naive Eigenverbrauchslogik, siehe battery_model.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.simulateEmsWithoutAi = exports.simulateReferenceSonnenNative = exports.simulateReferenceNoEms = exports.computeRealDayResult = void 0;
const battery_model_1 = require("./battery_model");
const constants_1 = require("./constants");
const exogenous_load_1 = require("./exogenous_load");
const types_1 = require("./types");
function round2(n) {
    return Math.round(n * 100) / 100;
}
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
function firstNonNull(arr) {
    for (const v of arr) {
        if (v !== null)
            return v;
    }
    return null;
}
function lastNonNull(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] !== null)
            return arr[i];
    }
    return null;
}
/**
 * Aggregiert den real gemessenen Tag aus den day_telemetry-Buckets — keine Simulation.
 * `feedInCtPerKwh`: Admin-Einspeisevergütung (ct/kWh), null wenn nicht konfiguriert
 * (dann bleibt exportCreditEur/netCostEur null statt eine Gutschrift zu erfinden).
 */
function computeRealDayResult(day, feedInCtPerKwh) {
    const b = day.buckets;
    const n = day.slotCount;
    let gridImportKwh = 0;
    let gridExportKwh = 0;
    let batteryChargeKwh = 0;
    let batteryDischargeKwh = 0;
    let importCostEur = 0;
    let exportCreditEur = 0;
    let missing = 0;
    let observed = 0;
    let haveImport = false;
    let haveExport = false;
    let haveCharge = false;
    let haveDischarge = false;
    let haveImportCost = false;
    for (let i = 0; i < n; i++) {
        const gi = b.gridImportKwh[i];
        const ge = b.gridExportKwh[i];
        const price = b.priceCtPerKwh[i];
        const bc = b.batteryChargedKwh[i];
        const bd = b.batteryDischargedKwh[i];
        if (gi === null && ge === null && bc === null && bd === null) {
            missing += 1;
            continue;
        }
        observed += 1;
        if (gi !== null) {
            gridImportKwh += gi;
            haveImport = true;
            if (price !== null) {
                importCostEur += (gi * price) / 100;
                haveImportCost = true;
            }
        }
        if (ge !== null) {
            gridExportKwh += ge;
            haveExport = true;
            if (feedInCtPerKwh !== null && feedInCtPerKwh >= 0) {
                exportCreditEur += (ge * feedInCtPerKwh) / 100;
            }
        }
        if (bc !== null) {
            batteryChargeKwh += bc;
            haveCharge = true;
        }
        if (bd !== null) {
            batteryDischargeKwh += bd;
            haveDischarge = true;
        }
    }
    const haveExportCredit = haveExport && feedInCtPerKwh !== null && feedInCtPerKwh >= 0;
    const netCostEur = haveImportCost
        ? round2(importCostEur - (haveExportCredit ? exportCreditEur : 0))
        : null;
    return {
        gridImportKwh: haveImport ? round3(gridImportKwh) : null,
        gridExportKwh: haveExport ? round3(gridExportKwh) : null,
        batteryChargeKwh: haveCharge ? round3(batteryChargeKwh) : null,
        batteryDischargeKwh: haveDischarge ? round3(batteryDischargeKwh) : null,
        socStartPct: firstNonNull(b.batterySocEndPct),
        socEndPct: lastNonNull(b.batterySocEndPct),
        importCostEur: haveImportCost ? round2(importCostEur) : null,
        exportCreditEur: haveExportCredit ? round2(exportCreditEur) : null,
        netCostEur,
        slotCount: n,
        observedSlotCount: observed,
        missingSlotCount: missing,
    };
}
exports.computeRealDayResult = computeRealDayResult;
const NO_EMS_ASSUMPTIONS_DE = [
    "IDEAL-BENCHMARK: perfekte 0-W-Eigenverbrauchsbatterie — NICHT die reale Sonnen ohne EMS.",
    "Exogene Grundlast = reale Hauslast minus steuerbare EMS-Verbraucher (Klima Shared-Power, Heizstab, EV) — keine Doppelzählung.",
    "Klima/Heizstab/EV laufen zeitlich wie real gemessen (kein belastbares alternatives Zeitsteuerungsmodell).",
    "Batterie: naive Eigenverbrauchslogik ohne Preis-/PV-Timing, ohne Nachtreserve, ohne Netzausgleich.",
    "PV-Erzeugung wie real gemessen — EMS beeinflusst nicht, wie viel die Anlage produziert.",
];
const SONNEN_NATIVE_ASSUMPTIONS_DE = [
    "REALISTISCH OHNE EMS: empirisches Sonnen-Verhalten ohne Grid-Balance (α/β), keine perfekte 0-W-Batterie.",
    "Klima/Heizstab/EV zeitlich wie real — keine erfundenen Cent-Konten.",
    "Ohne belastbare α/β ist die GB-Wirtschaftlichkeit nicht bewertbar (null, nicht 0 €).",
];
/** Gegenwelt "reference_no_ems": Batterie fährt naive Eigenverbrauchslogik statt EMS-Planung. */
function simulateReferenceNoEms(day, params, feedInCtPerKwh) {
    if (params.usableCapacityKwh === null ||
        !(params.usableCapacityKwh > 0) ||
        params.minSocPct === null ||
        params.maxSocPct === null ||
        params.startSocPct === null) {
        return (0, types_1.notEvaluableStrategyResult)("reference_no_ems", [
            ...NO_EMS_ASSUMPTIONS_DE,
            "Batteriekapazität, SOC-Hardwaregrenzen oder Start-SOC zum Tagesbeginn nicht verfügbar — Shadow-Tag nicht bewertbar (kein erfundener Wert).",
        ]);
    }
    const slotHours = day.slotWidthMs / 3_600_000;
    const split = (0, exogenous_load_1.splitExogenousLoad)(day);
    const sim = (0, battery_model_1.simulateGreedyBatterySelfConsumption)({
        pvKwh: day.buckets.pvKwh,
        totalLoadKwh: split.noEmsTotalLoadKwh,
        slotHours,
        startSocPct: params.startSocPct,
        usableCapacityKwh: params.usableCapacityKwh,
        minSocPct: params.minSocPct,
        maxSocPct: params.maxSocPct,
        maxChargeW: params.maxChargeW,
        maxDischargeW: params.maxDischargeW,
    });
    let gridImportKwh = 0;
    let gridExportKwh = 0;
    let batteryChargeKwh = 0;
    let batteryDischargeKwh = 0;
    let importCostEur = 0;
    let exportCreditEur = 0;
    let haveImportCost = false;
    for (let i = 0; i < day.slotCount; i++) {
        const gi = sim.gridImportKwh[i];
        const ge = sim.gridExportKwh[i];
        const bc = sim.batteryChargeKwh[i];
        const bd = sim.batteryDischargeKwh[i];
        const price = day.buckets.priceCtPerKwh[i];
        if (gi !== null) {
            gridImportKwh += gi;
            if (price !== null) {
                importCostEur += (gi * price) / 100;
                haveImportCost = true;
            }
        }
        if (ge !== null && feedInCtPerKwh !== null && feedInCtPerKwh >= 0) {
            exportCreditEur += (ge * feedInCtPerKwh) / 100;
        }
        if (bc !== null)
            batteryChargeKwh += bc;
        if (bd !== null)
            batteryDischargeKwh += bd;
    }
    const n = day.slotCount;
    const evaluable = n > 0 && sim.missingSlots <= n * constants_1.SHADOW_MAX_MISSING_SLOT_FRACTION && haveImportCost;
    const haveExportCredit = feedInCtPerKwh !== null && feedInCtPerKwh >= 0;
    return {
        strategy: "reference_no_ems",
        modelVersion: constants_1.SHADOW_ENGINE_MODEL_VERSION,
        evaluable,
        missingSlotCount: sim.missingSlots,
        assumptionsDe: evaluable
            ? NO_EMS_ASSUMPTIONS_DE
            : [...NO_EMS_ASSUMPTIONS_DE, `Zu viele fehlende Slots (${sim.missingSlots}/${n}) — nicht belastbar.`],
        gridImportKwh: round3(gridImportKwh),
        gridExportKwh: round3(gridExportKwh),
        batteryChargeKwh: round3(batteryChargeKwh),
        batteryDischargeKwh: round3(batteryDischargeKwh),
        socStartPct: params.startSocPct,
        socEndPct: firstNonNull([...sim.socPct].reverse()),
        importCostEur: haveImportCost ? round2(importCostEur) : null,
        exportCreditEur: haveExportCredit ? round2(exportCreditEur) : null,
        netCostEur: haveImportCost ? round2(importCostEur - (haveExportCredit ? exportCreditEur : 0)) : null,
    };
}
exports.simulateReferenceNoEms = simulateReferenceNoEms;
function simulateReferenceSonnenNative(real, day, learning, feedInCtPerKwh) {
    if (!learning.usable || learning.alpha == null || learning.beta == null) {
        return (0, types_1.notEvaluableStrategyResult)("reference_sonnen_native", [
            ...SONNEN_NATIVE_ASSUMPTIONS_DE,
            "α/β noch nicht belastbar — realistische Ohne-EMS-Welt für Grid Balance nicht bewertbar.",
        ]);
    }
    const b = day.buckets;
    let extraImport = 0;
    let extraImportCost = 0;
    let haveGbPrice = false;
    let gbDay = 0;
    for (let i = 0; i < day.slotCount; i++) {
        const gb = b.gridBalanceDischargeKwh[i];
        const price = b.priceCtPerKwh[i];
        if (gb == null || !(gb > 0))
            continue;
        gbDay += gb;
        const avoided = learning.alpha * gb;
        extraImport += avoided;
        if (price != null) {
            extraImportCost += (avoided * price) / 100;
            haveGbPrice = true;
        }
    }
    if (gbDay <= 0) {
        const evaluable = real.netCostEur !== null && real.observedSlotCount > 0;
        return {
            strategy: "reference_sonnen_native",
            modelVersion: constants_1.SHADOW_ENGINE_MODEL_VERSION,
            evaluable,
            missingSlotCount: real.missingSlotCount,
            assumptionsDe: [...SONNEN_NATIVE_ASSUMPTIONS_DE, "Kein GB an diesem Tag — real ≈ native für GB."],
            gridImportKwh: real.gridImportKwh,
            gridExportKwh: real.gridExportKwh,
            batteryChargeKwh: real.batteryChargeKwh,
            batteryDischargeKwh: real.batteryDischargeKwh,
            socStartPct: real.socStartPct,
            socEndPct: real.socEndPct,
            importCostEur: real.importCostEur,
            exportCreditEur: real.exportCreditEur,
            netCostEur: real.netCostEur,
        };
    }
    if (real.gridImportKwh == null || real.importCostEur == null || !haveGbPrice) {
        return (0, types_1.notEvaluableStrategyResult)("reference_sonnen_native", [
            ...SONNEN_NATIVE_ASSUMPTIONS_DE,
            "GB-Slots ohne belastbaren Preis oder Import — nicht bewertbar.",
        ]);
    }
    const extraBatt = learning.beta * gbDay;
    const importCostEur = round2(real.importCostEur + extraImportCost);
    const exportCreditEur = real.exportCreditEur;
    return {
        strategy: "reference_sonnen_native",
        modelVersion: constants_1.SHADOW_ENGINE_MODEL_VERSION,
        evaluable: true,
        missingSlotCount: real.missingSlotCount,
        assumptionsDe: SONNEN_NATIVE_ASSUMPTIONS_DE,
        gridImportKwh: round3(real.gridImportKwh + extraImport),
        gridExportKwh: real.gridExportKwh,
        batteryChargeKwh: real.batteryChargeKwh,
        batteryDischargeKwh: real.batteryDischargeKwh != null ? round3(Math.max(0, real.batteryDischargeKwh - extraBatt)) : null,
        socStartPct: real.socStartPct,
        socEndPct: real.socEndPct,
        importCostEur,
        exportCreditEur,
        netCostEur: round2(importCostEur - (exportCreditEur ?? 0)),
    };
}
exports.simulateReferenceSonnenNative = simulateReferenceSonnenNative;
const WITHOUT_AI_ASSUMPTIONS_DE = [
    "KI mutiert im Live-Betrieb keine Allokationen (AI_ALLOCATION_LIVE_MUTATION_ENABLED=false, siehe src/ai/writeback/authority.ts) — der real gemessene Tag entspricht daher exakt dem KI-freien EMS-Betrieb.",
];
/**
 * Gegenwelt "ems_without_ai": Solange KI niemals live in Allokationen eingreift (aktueller
 * Produktionszustand, siehe `AI_ALLOCATION_LIVE_MUTATION_ENABLED`), IST der reale Tag exakt
 * die KI-freie Welt — keine zusätzliche Simulation nötig oder zulässig (sonst würde eine
 * Abweichung erfunden, die es nie gab). Sobald ein validierter KI-Override (Phase 6) für einen
 * Tag aktiv war, muss `aiOverrideActiveForDay=true` übergeben werden — dann ist dieser Tag mit
 * dem aktuellen Modell nicht mehr exakt rekonstruierbar und wird als nicht bewertbar markiert,
 * statt eine Rückrechnung zu erfinden.
 */
function simulateEmsWithoutAi(real, aiOverrideActiveForDay) {
    if (aiOverrideActiveForDay) {
        return (0, types_1.notEvaluableStrategyResult)("ems_without_ai", [
            "An diesem Tag war ein validierter KI-Override aktiv — der reale Tag ist damit nicht mehr identisch mit der KI-freien Welt. Eine Rückrechnung des Override-Effekts ist mit dem aktuellen Modell nicht belastbar möglich; Tag als nicht bewertbar markiert statt eines geschätzten Werts.",
        ]);
    }
    const evaluable = real.observedSlotCount > 0 && real.netCostEur !== null;
    return {
        strategy: "ems_without_ai",
        modelVersion: constants_1.SHADOW_ENGINE_MODEL_VERSION,
        evaluable,
        missingSlotCount: real.missingSlotCount,
        assumptionsDe: WITHOUT_AI_ASSUMPTIONS_DE,
        gridImportKwh: real.gridImportKwh,
        gridExportKwh: real.gridExportKwh,
        batteryChargeKwh: real.batteryChargeKwh,
        batteryDischargeKwh: real.batteryDischargeKwh,
        socStartPct: real.socStartPct,
        socEndPct: real.socEndPct,
        importCostEur: real.importCostEur,
        exportCreditEur: real.exportCreditEur,
        netCostEur: real.netCostEur,
    };
}
exports.simulateEmsWithoutAi = simulateEmsWithoutAi;
