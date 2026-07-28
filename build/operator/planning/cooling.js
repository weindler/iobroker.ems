"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coolingReserveW = exports.planCooling = void 0;
const time_1 = require("../../addons/air_conditioning/runtime/time");
const learned_power_1 = require("../../learning/consumer_stats/learned_power");
const consumer_allocate_1 = require("../../planner/consumer_allocate");
const climate_energy_1 = require("./climate_energy");
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
function estimateUnitClimate(input) {
    const { unit } = input;
    const learned = (0, learned_power_1.resolveConsumerEffectivePowerW)(input.consumerStats, unit.estimatedPowerW, input.nowMs);
    const none = (reasonDe) => ({
        unitIndex: unit.index,
        name: unit.name,
        powerW: learned.powerW,
        powerSource: learned.source,
        likelyActive: false,
        expectedHours: 0,
        expectedKwh: 0,
        coolingHours: 0,
        dehumidifyHours: 0,
        reasonDe,
    });
    if (input.remainingHours <= 0) {
        return none("Außerhalb Zeitfenster.");
    }
    const learnedHours = learned.medianRuntimeSecPerDay !== null && learned.medianRuntimeSecPerDay > 0
        ? learned.medianRuntimeSecPerDay / 3600
        : null;
    const cooling = (0, climate_energy_1.estimateCoolingHours)({
        outdoorMaxC: input.outdoorMaxC,
        outdoorLikelyTempC: input.outdoorLikelyTempC,
        remainingHours: input.remainingHours,
        learnedHours,
        roomTempC: input.roomTempC,
        onTempC: unit.onTempC,
        offTempC: unit.offTempC,
    });
    const dryConfigured = Boolean(unit.modeWhenDehumidify?.trim()) && unit.maxHumidityPct !== null;
    const dehumidify = (0, climate_energy_1.estimateDehumidifyHours)({
        outdoorMaxC: input.outdoorMaxC,
        outdoorLikelyTempC: input.outdoorLikelyTempC,
        remainingHours: input.remainingHours,
        learnedHours,
        roomHumidityPct: input.roomHumidityPct,
        maxHumidityPct: unit.maxHumidityPct,
        dryModeConfigured: dryConfigured,
    });
    // Kühlung und Entfeuchten teilen oft denselben Verdichter — Stunden nicht doppelt zählen.
    const expectedHours = Math.min(input.remainingHours, Math.max(cooling.expectedHours, dehumidify.expectedHours));
    const likelyActive = (cooling.likelyActive || dehumidify.likelyActive) && expectedHours > 0;
    if (!likelyActive) {
        const reason = cooling.reasonDe || dehumidify.reasonDe || "Kein Klima-Bedarf";
        return none(reason);
    }
    const expectedKwh = (learned.powerW * expectedHours) / 1000;
    const powerLabel = learned.source === "learned" ? `${learned.powerW} W (gelernt)` : `${learned.powerW} W (Config)`;
    const parts = [];
    if (cooling.likelyActive)
        parts.push(`Kühl: ${cooling.reasonDe}`);
    if (dehumidify.likelyActive)
        parts.push(`Entfeucht: ${dehumidify.reasonDe}`);
    if (learned.source === "learned" && learnedHours !== null) {
        parts.push(`Ø ${Math.round(learnedHours * 10) / 10} h/Tag (${learned.sampleDays} Tage)`);
    }
    parts.push(powerLabel);
    return {
        unitIndex: unit.index,
        name: unit.name,
        powerW: learned.powerW,
        powerSource: learned.source,
        likelyActive: true,
        expectedHours: Math.round(expectedHours * 100) / 100,
        expectedKwh: Math.round(expectedKwh * 1000) / 1000,
        coolingHours: cooling.expectedHours,
        dehumidifyHours: dehumidify.expectedHours,
        reasonDe: parts.join("; "),
    };
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
                likelyActive: false,
                expectedHours: 0,
                expectedKwh: 0,
                coolingHours: 0,
                dehumidifyHours: 0,
                reasonDe: "Außerhalb Betriebszeit.",
            });
            continue;
        }
        forecasts.push(estimateUnitClimate({
            unit,
            roomTempC: row.roomTempC,
            roomHumidityPct: row.roomHumidityPct ?? null,
            outdoorMaxC,
            outdoorLikelyTempC: input.acConfig.plannerOutdoorLikelyTempC,
            remainingHours: remainingActiveHours(input.now, unit),
            consumerStats: row.consumerStats,
            nowMs: input.now.getTime(),
        }));
    }
    const activeForecasts = forecasts.filter((f) => f.likelyActive && f.powerW > 0);
    const likelyActive = activeForecasts.length > 0;
    const expectedKwh = forecasts.reduce((sum, f) => sum + f.expectedKwh, 0);
    const peakUnitPowers = activeForecasts.map((f) => f.powerW);
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
        parts.push("Heute voraussichtlich keine Kühlung/Entfeuchtung.");
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
