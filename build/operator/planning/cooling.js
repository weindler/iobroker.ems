"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coolingReserveW = exports.planCooling = void 0;
const time_1 = require("../../addons/air_conditioning/runtime/time");
const learned_power_1 = require("../../learning/consumer_stats/learned_power");
const consumer_allocate_1 = require("../../planner/consumer_allocate");
const math_1 = require("../../learning/climate_shared_power/math");
const climate_predictive_1 = require("./climate_predictive");
function remainingActiveHours(now, unit) {
    const nowMin = (0, time_1.localMinutesNow)(now);
    if ((0, time_1.isHardOffTime)(nowMin, unit.hardOffAt)) {
        return 0;
    }
    const untilMin = parseClockEnd(unit.activeUntil);
    const hardOffMin = parseClockEnd(unit.hardOffAt);
    let endMin = untilMin ?? hardOffMin;
    if (hardOffMin !== null && (endMin === null || hardOffMin < endMin)) {
        endMin = hardOffMin;
    }
    if (endMin === null) {
        return 8;
    }
    if (endMin <= nowMin) {
        return 0;
    }
    return (endMin - nowMin) / 60;
}
function parseClockEnd(raw) {
    const m = String(raw ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m)
        return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(min))
        return null;
    return h * 60 + min;
}
/**
 * PHASE 3 — Shared-Power/Climate Learning: löst die elektrische Leistung DIESER Unit alleine
 * (Solo-Kombination, `activeUnitCombinationKey` für genau einen aktiven Index) für die
 * gegebene Betriebsart über das gruppenbewusste Learning auf. Grund: die bisherige reine
 * Pro-Unit-`consumer_stats`-Kette speist bei geteilten Außengeräten den ROHEN (nicht
 * deduplizierten) Sensorwert ein — Tage mit gleichzeitigem Betrieb beider Innengeräte blähen
 * den gelernten Solo-Wert künstlich auf. Ohne Gruppe/ohne belastbares Sample: unverändertes
 * bestehendes Verhalten (Consumer-Stats/Config-Fallback).
 */
function resolveGroupAwarePowerW(unit, purpose, fallback, sharedPowerStats) {
    if (!unit.sharedPowerGroupId || !sharedPowerStats) {
        return { powerW: fallback.powerW, source: fallback.source, noteDe: null };
    }
    const soloCombo = String(unit.index);
    const key = (0, math_1.climateSharedPowerKey)(unit.sharedPowerGroupId, purpose, soloCombo);
    const resolution = (0, math_1.resolveClimateSharedPowerW)(sharedPowerStats[key], fallback.powerW);
    if (resolution.source === "learned") {
        return { powerW: resolution.powerW, source: "learned_shared", noteDe: resolution.reasonDe };
    }
    return { powerW: fallback.powerW, source: fallback.source, noteDe: null };
}
function estimateUnitClimate(input) {
    const { unit } = input;
    const learned = (0, learned_power_1.resolveConsumerEffectivePowerW)(input.consumerStats, unit.estimatedPowerW, input.nowMs);
    const none = (reasonDe, demandModel = "legacy_fallback", fallbackReasonDe = reasonDe) => ({
        unitIndex: unit.index,
        name: unit.name,
        powerW: learned.powerW,
        powerSource: learned.source,
        powerPurpose: null,
        likelyActive: false,
        expectedHours: 0,
        expectedKwh: 0,
        coolingHours: 0,
        heatingHours: 0,
        dehumidifyHours: 0,
        reasonDe,
        demandModel,
        fallbackReasonDe,
        predictiveConfidence: null,
        predictedCrossingAtIso: null,
        predictedPeakRoomTempC: null,
        predictedLowRoomTempC: null,
        predictedPeakHumidityPct: null,
    });
    if (input.remainingHours <= 0) {
        return none("Außerhalb Zeitfenster.");
    }
    const learnedHours = learned.medianRuntimeSecPerDay !== null && learned.medianRuntimeSecPerDay > 0
        ? learned.medianRuntimeSecPerDay / 3600
        : null;
    const demand = (0, climate_predictive_1.estimateClimateUnitDemand)({
        now: input.now,
        unit,
        roomTempC: input.roomTempC,
        roomHumidityPct: input.roomHumidityPct,
        outdoorTempC: input.outdoorTempC,
        outdoorForecastMaxC: input.outdoorMaxC,
        outdoorLikelyTempC: input.outdoorLikelyTempC,
        remainingHours: input.remainingHours,
        windowEndMs: input.windowEndMs,
        hourlyPoints: input.hourlyPoints,
        thermal: input.thermal,
        learnedHours,
    });
    const cooling = demand.cooling;
    const heating = demand.heating;
    const dehumidify = demand.dehumidify;
    // Kühlung, Heizen und Entfeuchten teilen oft denselben Verdichter — Stunden nicht doppelt zählen.
    const expectedHours = Math.min(input.remainingHours, Math.max(cooling.expectedHours, heating.expectedHours, dehumidify.expectedHours));
    const likelyActive = (cooling.likelyActive || heating.likelyActive || dehumidify.likelyActive) && expectedHours > 0;
    if (!likelyActive) {
        return {
            ...none(demand.reasonDe, demand.demandModel, demand.fallbackReasonDe),
            predictiveConfidence: demand.predictiveConfidence,
            predictedCrossingAtIso: cooling.predictedCrossingAtIso ??
                heating.predictedCrossingAtIso ??
                dehumidify.predictedCrossingAtIso,
            predictedPeakRoomTempC: cooling.predictedPeak ?? heating.predictedPeak,
            predictedLowRoomTempC: heating.predictedLow ?? cooling.predictedLow,
            predictedPeakHumidityPct: dehumidify.predictedPeak,
        };
    }
    const purpose = cooling.likelyActive
        ? "cooling"
        : heating.likelyActive
            ? "heating"
            : "dehumidify";
    const resolved = resolveGroupAwarePowerW(unit, purpose, learned, input.sharedPowerStats);
    const expectedKwh = (resolved.powerW * expectedHours) / 1000;
    const powerLabel = resolved.source === "learned_shared"
        ? `${resolved.powerW} W (gelernt, Shared-Power)`
        : resolved.source === "learned"
            ? `${resolved.powerW} W (gelernt)`
            : `${resolved.powerW} W (Config)`;
    const parts = [`demand_model=${demand.demandModel}`];
    if (cooling.likelyActive)
        parts.push(`Kühl: ${cooling.reasonDe}`);
    if (heating.likelyActive)
        parts.push(`Heiz: ${heating.reasonDe}`);
    if (dehumidify.likelyActive)
        parts.push(`Entfeucht: ${dehumidify.reasonDe}`);
    if (demand.fallbackReasonDe)
        parts.push(demand.fallbackReasonDe);
    if (learned.source === "learned" && learnedHours !== null) {
        parts.push(`Ø ${Math.round(learnedHours * 10) / 10} h/Tag (${learned.sampleDays} Tage)`);
    }
    parts.push(powerLabel);
    return {
        unitIndex: unit.index,
        name: unit.name,
        powerW: resolved.powerW,
        powerSource: resolved.source,
        powerPurpose: purpose,
        likelyActive: true,
        expectedHours: Math.round(expectedHours * 100) / 100,
        expectedKwh: Math.round(expectedKwh * 1000) / 1000,
        coolingHours: cooling.expectedHours,
        heatingHours: heating.expectedHours,
        dehumidifyHours: dehumidify.expectedHours,
        reasonDe: parts.join("; "),
        demandModel: demand.demandModel,
        fallbackReasonDe: demand.fallbackReasonDe,
        predictiveConfidence: demand.predictiveConfidence,
        predictedCrossingAtIso: cooling.predictedCrossingAtIso ??
            heating.predictedCrossingAtIso ??
            dehumidify.predictedCrossingAtIso,
        predictedPeakRoomTempC: cooling.predictedPeak ?? heating.predictedPeak,
        predictedLowRoomTempC: heating.predictedLow ?? cooling.predictedLow,
        predictedPeakHumidityPct: dehumidify.predictedPeak,
    };
}
/**
 * PHASE 3 — Shared-Power/Climate Learning: verhindert additive Doppelzählung der Peak-Leistung,
 * wenn mehrere aktive Units eines Plans dasselbe Außengerät teilen (`sharedPowerGroupId`).
 * Bevorzugt den gelernten Kombi-Wert für genau diese Kombination (z. B. "1+2"); ohne
 * belastbares Sample: konservativ max() statt Summe — dieselbe Fallback-Logik wie die
 * bestehende Live-Deduplizierung (`addons/air_conditioning/shared_power.ts`), NICHT
 * 700 W + 700 W für ein Außengerät, das real nur einmal zieht.
 */
function dedupSharedGroupPeakPowers(activeForecasts, enabledUnits, sharedPowerStats) {
    const unitByIndex = new Map(enabledUnits.map((r) => [r.unit.index, r.unit]));
    const groups = new Map();
    const standalone = [];
    for (const f of activeForecasts) {
        const groupId = unitByIndex.get(f.unitIndex)?.sharedPowerGroupId ?? null;
        if (!groupId || !f.powerPurpose) {
            standalone.push(f.powerW);
            continue;
        }
        const gKey = `${groupId}|${f.powerPurpose}`;
        const arr = groups.get(gKey) ?? [];
        arr.push(f);
        groups.set(gKey, arr);
    }
    const result = [...standalone];
    for (const [gKey, members] of groups) {
        if (members.length === 1) {
            result.push(members[0].powerW);
            continue;
        }
        const sep = gKey.indexOf("|");
        const groupId = gKey.slice(0, sep);
        const purpose = gKey.slice(sep + 1);
        const combo = [...members]
            .map((m) => m.unitIndex)
            .sort((a, b) => a - b)
            .join("+");
        const combinedKey = (0, math_1.climateSharedPowerKey)(groupId, purpose, combo);
        const maxSolo = Math.max(...members.map((m) => m.powerW));
        const resolution = (0, math_1.resolveClimateSharedPowerW)(sharedPowerStats?.[combinedKey], maxSolo);
        result.push(resolution.source === "learned" ? resolution.powerW : maxSolo);
    }
    return result;
}
function planCooling(input) {
    const none = (reason) => ({
        expected_kwh_today: 0,
        expected_peak_w: 0,
        likely_active: false,
        reason_de: reason,
        forecast_active: false,
        units: [],
    });
    if (!input.governanceEnabled) {
        return none("Klima-Governance deaktiviert.");
    }
    const enabledUnits = input.units.filter(({ unit }) => unit.enabled);
    if (enabledUnits.length === 0) {
        return none("Kein Innengerät aktiv.");
    }
    const outdoorMaxC = input.outdoorForecastMaxC !== null &&
        input.outdoorForecastMaxC !== undefined &&
        Number.isFinite(input.outdoorForecastMaxC)
        ? input.outdoorForecastMaxC
        : input.outdoorTempC;
    const nowMin = (0, time_1.localMinutesNow)(input.now);
    const forecasts = [];
    for (const row of enabledUnits) {
        const { unit } = row;
        if (!(0, time_1.isWithinClockWindow)(nowMin, unit.activeFrom, unit.activeUntil) || (0, time_1.isHardOffTime)(nowMin, unit.hardOffAt)) {
            forecasts.push({
                unitIndex: unit.index,
                name: unit.name,
                powerW: unit.estimatedPowerW,
                powerSource: "config",
                powerPurpose: null,
                likelyActive: false,
                expectedHours: 0,
                expectedKwh: 0,
                coolingHours: 0,
                heatingHours: 0,
                dehumidifyHours: 0,
                reasonDe: "Außerhalb Betriebszeit.",
                demandModel: "legacy_fallback",
                fallbackReasonDe: "Außerhalb Betriebszeit.",
                predictiveConfidence: null,
                predictedCrossingAtIso: null,
                predictedPeakRoomTempC: null,
                predictedLowRoomTempC: null,
                predictedPeakHumidityPct: null,
            });
            continue;
        }
        const remainingHours = remainingActiveHours(input.now, unit);
        forecasts.push(estimateUnitClimate({
            unit,
            roomTempC: row.roomTempC,
            roomHumidityPct: row.roomHumidityPct ?? null,
            outdoorTempC: input.outdoorTempC,
            outdoorMaxC,
            outdoorLikelyTempC: input.acConfig.plannerOutdoorLikelyTempC,
            remainingHours,
            windowEndMs: (0, climate_predictive_1.climateWindowEndMs)(input.now, remainingHours),
            now: input.now,
            hourlyPoints: input.hourlyPoints ?? [],
            thermal: input.thermalModels?.[String(unit.index)],
            consumerStats: row.consumerStats,
            sharedPowerStats: input.sharedPowerStats,
            nowMs: input.now.getTime(),
        }));
    }
    const activeForecasts = forecasts.filter((f) => f.likelyActive && f.powerW > 0);
    const likelyActive = activeForecasts.length > 0;
    const expectedKwh = forecasts.reduce((sum, f) => sum + f.expectedKwh, 0);
    const peakUnitPowers = dedupSharedGroupPeakPowers(activeForecasts, enabledUnits, input.sharedPowerStats);
    const expectedPeakW = likelyActive
        ? (0, consumer_allocate_1.sumAllocatedConsumerPeakW)(peakUnitPowers, input.acConfig.outdoorMaxPowerW)
        : 0;
    const parts = [];
    if (likelyActive) {
        parts.push(`${activeForecasts.length} Unit(s), ~${Math.round(expectedKwh * 10) / 10} kWh, Peak ${expectedPeakW} W`);
        for (const f of activeForecasts) {
            parts.push(`${f.name}: ${f.reasonDe}`);
        }
    }
    else {
        parts.push("Heute voraussichtlich kein Climate-Bedarf.");
    }
    return {
        expected_kwh_today: Math.round(expectedKwh * 1000) / 1000,
        expected_peak_w: expectedPeakW,
        likely_active: likelyActive,
        reason_de: parts.join(" | "),
        forecast_active: outdoorMaxC !== null ||
            enabledUnits.some((u) => u.roomTempC !== null || (u.roomHumidityPct ?? null) !== null),
        units: forecasts,
    };
}
exports.planCooling = planCooling;
function coolingReserveW(cooling) {
    return cooling.likely_active ? cooling.expected_peak_w : 0;
}
exports.coolingReserveW = coolingReserveW;
