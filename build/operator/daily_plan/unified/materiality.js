"use strict";
/**
 * Plan-vs-Actual Materiality — kleine, nachvollziehbare Schwellen.
 * Wiederverwendet die AI-Digest-Bucket-Größen wo sinnvoll (PV 2 kWh, Preis 5 ct).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateMaterialReplan = exports.pvRevisionContext = exports.REPLAN_COOLDOWN_MS = exports.MATERIAL_VEHICLE_ENERGY_KWH = exports.MATERIAL_THERMAL_TEMP_K = exports.MATERIAL_THERMAL_HEADROOM_KWH = exports.MATERIAL_BATTERY_SOC_PP = exports.MATERIAL_HOUSE_LOAD_KWH = void 0;
const trigger_digest_1 = require("../../../ai/trigger_digest");
const reason_codes_1 = require("./reason_codes");
/** Hauslast-Tagesabweichung / kumuliert — grober als AI-Flex-Bucket. */
exports.MATERIAL_HOUSE_LOAD_KWH = 1.5;
/** Batterie-SOC-Abweichung in Prozentpunkten. */
exports.MATERIAL_BATTERY_SOC_PP = 5;
/** Thermischer Headroom-Wechsel (kWh), der Replan rechtfertigt. */
exports.MATERIAL_THERMAL_HEADROOM_KWH = 0.5;
/** Temperatur-Delta (°C) als Zusatzsignal. */
exports.MATERIAL_THERMAL_TEMP_K = 2;
/** Fahrzeug-Energiebedarf-Änderung (kWh). */
exports.MATERIAL_VEHICLE_ENERGY_KWH = 1;
/** Anti-Chatter-Cooldown nach Replan (ms). */
exports.REPLAN_COOLDOWN_MS = 5 * 60_000;
function absDiff(a, b) {
    if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b))
        return null;
    return Math.abs(a - b);
}
/**
 * PV-Revision-Kontext: previous expected, neu, realisiert, Rest.
 * Vermeidet „neuer Tag = Summe“-Fehlinterpretation.
 */
function pvRevisionContext(baseline, actual) {
    const previousExpectedDayKwh = baseline.expectedPvDayKwh;
    const newExpectedDayKwh = actual.forecastPvDayKwh;
    const realizedKwh = actual.realizedPvKwh;
    let remainingExpectedKwh = null;
    if (newExpectedDayKwh !== null && realizedKwh !== null) {
        remainingExpectedKwh = Math.max(0, newExpectedDayKwh - realizedKwh);
    }
    else if (newExpectedDayKwh !== null && baseline.realizedPvKwhAtPlan !== null) {
        remainingExpectedKwh = Math.max(0, newExpectedDayKwh - baseline.realizedPvKwhAtPlan);
    }
    return { previousExpectedDayKwh, newExpectedDayKwh, realizedKwh, remainingExpectedKwh };
}
exports.pvRevisionContext = pvRevisionContext;
function evaluateMaterialReplan(baseline, actual, opts) {
    const reasons = [];
    let hard = false;
    if (!baseline) {
        return { shouldReplan: true, reasons: [reason_codes_1.REASON.REPLAN_DAY_ROLLOVER], hard: true };
    }
    if (actual.date !== baseline.date) {
        reasons.push(reason_codes_1.REASON.REPLAN_DAY_ROLLOVER);
        hard = true;
    }
    if (actual.cadenceDigest !== baseline.cadenceDigest) {
        // Cadence-Digest deckt Forecast-/Preis-/Flex-Familien ab — spezifizieren
        const pvBucketDiff = absDiff(baseline.expectedPvDayKwh, actual.forecastPvDayKwh);
        if (pvBucketDiff !== null && pvBucketDiff >= trigger_digest_1.AI_TRIGGER_PV_BUCKET_KWH) {
            reasons.push(reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED);
        }
        const priceDiff = absDiff(baseline.priceMedianCt, actual.priceMedianCt);
        if ((priceDiff !== null && priceDiff >= trigger_digest_1.AI_TRIGGER_PRICE_MEDIAN_BUCKET_CT) ||
            baseline.priceStructureDigest !== actual.priceStructureDigest) {
            reasons.push(reason_codes_1.REASON.REPLAN_PRICE_REVISION);
        }
        const loadDiff = absDiff(baseline.expectedHouseLoadDayKwh, actual.forecastHouseLoadDayKwh);
        if (loadDiff !== null && loadDiff >= exports.MATERIAL_HOUSE_LOAD_KWH) {
            reasons.push(reason_codes_1.REASON.REPLAN_HOUSE_LOAD_DEVIATION);
        }
        // Generischer Digest-Wechsel (Mode, Contributions, …)
        if (!reasons.includes(reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED) &&
            !reasons.includes(reason_codes_1.REASON.REPLAN_PRICE_REVISION) &&
            !reasons.includes(reason_codes_1.REASON.REPLAN_HOUSE_LOAD_DEVIATION)) {
            // Digest geändert ohne zuordenbare Einzelmetrik — trotzdem Material (z. B. Mode)
            reasons.push(reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED);
        }
    }
    // Unified-Input-PV/Hauslast auch ohne Cadence-Digest-Wechsel (z. B. Contribution-Day-kWh
    // geändert, während Daily-Plan-Totals wegen fehlendem Day-Match null bleiben).
    const pvForecastDiff = absDiff(baseline.expectedPvDayKwh, actual.forecastPvDayKwh);
    if (pvForecastDiff !== null &&
        pvForecastDiff >= trigger_digest_1.AI_TRIGGER_PV_BUCKET_KWH &&
        !reasons.includes(reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED)) {
        reasons.push(reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED);
    }
    const houseLoadForecastDiff = absDiff(baseline.expectedHouseLoadDayKwh, actual.forecastHouseLoadDayKwh);
    if (houseLoadForecastDiff !== null &&
        houseLoadForecastDiff >= exports.MATERIAL_HOUSE_LOAD_KWH &&
        !reasons.includes(reason_codes_1.REASON.REPLAN_HOUSE_LOAD_DEVIATION)) {
        reasons.push(reason_codes_1.REASON.REPLAN_HOUSE_LOAD_DEVIATION);
    }
    // Preisstruktur auch ohne generischen Digest-Parse (expliziter Baseline-Vergleich)
    if (baseline.priceStructureDigest !== actual.priceStructureDigest &&
        !reasons.includes(reason_codes_1.REASON.REPLAN_PRICE_REVISION)) {
        reasons.push(reason_codes_1.REASON.REPLAN_PRICE_REVISION);
    }
    // PV actual deviation: realisiert vs. anteilig erwartet
    if (actual.realizedPvKwh !== null &&
        baseline.expectedPvDayKwh !== null &&
        baseline.realizedPvKwhAtPlan !== null) {
        const realizedDelta = actual.realizedPvKwh - baseline.realizedPvKwhAtPlan;
        const expectedRemainingAtPlan = baseline.expectedPvDayKwh - baseline.realizedPvKwhAtPlan;
        // Grobe Heuristik: wenn realisierte Delta seit Plan stark von „Restprognose-Anteil“ abweicht
        void expectedRemainingAtPlan;
        if (Math.abs(realizedDelta) >= trigger_digest_1.AI_TRIGGER_PV_BUCKET_KWH) {
            const ctx = pvRevisionContext(baseline, actual);
            if (ctx.remainingExpectedKwh !== null &&
                baseline.expectedPvDayKwh !== null &&
                absDiff(ctx.newExpectedDayKwh, ctx.previousExpectedDayKwh) !== null &&
                (absDiff(ctx.newExpectedDayKwh, ctx.previousExpectedDayKwh) ?? 0) >= trigger_digest_1.AI_TRIGGER_PV_BUCKET_KWH) {
                reasons.push(reason_codes_1.REASON.REPLAN_PV_ACTUAL_DEVIATION);
            }
            else if (realizedDelta >= trigger_digest_1.AI_TRIGGER_PV_BUCKET_KWH * 1.5) {
                reasons.push(reason_codes_1.REASON.REPLAN_PV_ACTUAL_DEVIATION);
            }
        }
    }
    else if (actual.realizedPvKwh !== null &&
        baseline.expectedPvDayKwh !== null &&
        actual.forecastPvDayKwh !== null) {
        const remaining = Math.max(0, actual.forecastPvDayKwh - actual.realizedPvKwh);
        const previousRemaining = Math.max(0, baseline.expectedPvDayKwh - (baseline.realizedPvKwhAtPlan ?? 0));
        if (Math.abs(remaining - previousRemaining) >= trigger_digest_1.AI_TRIGGER_PV_BUCKET_KWH) {
            reasons.push(reason_codes_1.REASON.REPLAN_PV_ACTUAL_DEVIATION);
        }
    }
    const socDiff = absDiff(baseline.batterySocPct, actual.batterySocPct);
    if (socDiff !== null && socDiff >= exports.MATERIAL_BATTERY_SOC_PP) {
        reasons.push(reason_codes_1.REASON.REPLAN_BATTERY_SOC_DEVIATION);
    }
    const headDiff = absDiff(baseline.thermalHeadroomKwh, actual.thermalHeadroomKwh);
    const tempDiff = absDiff(baseline.bufferTempC, actual.bufferTempC);
    if (actual.thermalBlocked ||
        (headDiff !== null && headDiff >= exports.MATERIAL_THERMAL_HEADROOM_KWH) ||
        (tempDiff !== null && tempDiff >= exports.MATERIAL_THERMAL_TEMP_K)) {
        reasons.push(reason_codes_1.REASON.REPLAN_THERMAL_DEVIATION);
    }
    // Ziel erreicht: Headroom war >0, jetzt ~0
    if (baseline.thermalHeadroomKwh !== null &&
        baseline.thermalHeadroomKwh >= exports.MATERIAL_THERMAL_HEADROOM_KWH &&
        actual.thermalHeadroomKwh !== null &&
        actual.thermalHeadroomKwh < 0.05) {
        if (!reasons.includes(reason_codes_1.REASON.REPLAN_THERMAL_DEVIATION)) {
            reasons.push(reason_codes_1.REASON.REPLAN_THERMAL_DEVIATION);
        }
    }
    if (baseline.acMandatoryAny !== actual.acMandatoryAny) {
        reasons.push(reason_codes_1.REASON.REPLAN_AC_COMFORT_CHANGE);
        hard = true;
    }
    if (baseline.vehicleConnected === false && actual.vehicleConnected === true) {
        reasons.push(reason_codes_1.REASON.REPLAN_VEHICLE_CONNECTED);
        hard = true;
    }
    if (baseline.vehicleConnected === true && actual.vehicleConnected === false) {
        reasons.push(reason_codes_1.REASON.REPLAN_VEHICLE_DISCONNECTED);
        hard = true;
    }
    if (baseline.presenceDigest !== actual.presenceDigest &&
        !reasons.includes(reason_codes_1.REASON.REPLAN_VEHICLE_CONNECTED) &&
        !reasons.includes(reason_codes_1.REASON.REPLAN_VEHICLE_DISCONNECTED)) {
        reasons.push(reason_codes_1.REASON.REPLAN_VEHICLE_PRESENCE_CHANGED);
        // Explizite/gelernte Presence-Änderung: material, aber soft (Cooldown gilt)
    }
    const vehE = absDiff(baseline.vehicleRequiredEnergyKwh, actual.vehicleRequiredEnergyKwh);
    const vehSoc = absDiff(baseline.vehicleTargetSocPct, actual.vehicleTargetSocPct);
    const vehDeadlineChanged = (baseline.vehicleDeadlineIso ?? "") !== (actual.vehicleDeadlineIso ?? "");
    if ((baseline.vehicleConnected || actual.vehicleConnected) &&
        ((vehE !== null && vehE >= exports.MATERIAL_VEHICLE_ENERGY_KWH) ||
            vehDeadlineChanged ||
            (vehSoc !== null && vehSoc >= 5))) {
        reasons.push(reason_codes_1.REASON.REPLAN_VEHICLE_GOAL_CHANGED);
        hard = true;
    }
    const unique = [...new Set(reasons)];
    if (unique.length === 0) {
        return { shouldReplan: false, reasons: [], hard: false };
    }
    const cadenceMoved = actual.cadenceDigest !== baseline.cadenceDigest;
    const forecastRevision = cadenceMoved ||
        unique.includes(reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED) ||
        unique.includes(reason_codes_1.REASON.REPLAN_PRICE_REVISION) ||
        unique.includes(reason_codes_1.REASON.REPLAN_HOUSE_LOAD_DEVIATION);
    const lastReplan = opts?.lastReplanAtMs ?? null;
    // Anti-Chatter: Cooldown nur für weiche Plan-vs-Actual-Abweichungen.
    // Cadence-/Forecast-Revision und harte Events (Vehicle, Tag, Komfort) immer erlaubt.
    if (!hard &&
        !forecastRevision &&
        lastReplan !== null &&
        actual.nowMs - lastReplan < exports.REPLAN_COOLDOWN_MS) {
        return { shouldReplan: false, reasons: unique, hard: false };
    }
    return { shouldReplan: true, reasons: unique, hard };
}
exports.evaluateMaterialReplan = evaluateMaterialReplan;
