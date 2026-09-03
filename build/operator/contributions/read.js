"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectContributions = exports.parseHouseLoadForecastHorizonJson = exports.parseHouseLoadForecastJson = void 0;
const state_util_1 = require("../../ems_light/state_util");
const config_1 = require("../../intent/config");
const config_2 = require("../../learning/weather/config");
const horizon_1 = require("../../learning/weather/horizon");
const constants_1 = require("../../learning/pv_horizon/constants");
const time_1 = require("../time");
const pv_1 = require("./pv");
const pv_shape_config_1 = require("./pv_shape_config");
const house_load_1 = require("./house_load");
const weather_1 = require("./weather");
const weather_hourly_1 = require("./weather_hourly");
const constraints_1 = require("./constraints");
const grid_read_1 = require("../supply/grid_read");
const grid_1 = require("../supply/grid");
async function readNum(host, relId) {
    try {
        const st = await host.getStateAsync(relId);
        return (0, state_util_1.asNum)(st?.val);
    }
    catch {
        return null;
    }
}
async function readStr(host, relId) {
    try {
        const st = await host.getStateAsync(relId);
        if (st?.val == null || st.val === "")
            return null;
        return String(st.val);
    }
    catch {
        return null;
    }
}
async function readForeignNum(host, stateId) {
    if (!stateId.trim())
        return null;
    try {
        const st = await host.getForeignStateAsync?.(stateId);
        return (0, state_util_1.asNum)(st?.val);
    }
    catch {
        return null;
    }
}
async function readForeignStr(host, stateId) {
    if (!stateId.trim())
        return null;
    try {
        const st = await host.getForeignStateAsync?.(stateId);
        if (st?.val == null || st.val === "")
            return null;
        return String(st.val);
    }
    catch {
        return null;
    }
}
/**
 * `system.config.common.latitude/longitude` — kein erfundener Standort ohne diesen Eintrag.
 * Toleranter Zahlen-Parse (wie `asNum`): manche Systemeinstellungen speichern den Wert je nach
 * Float-Teilerzeichen als String mit Komma statt Punkt — ein reiner `typeof === "number"`-Check
 * würde diesen sonst gültigen Standort fälschlich verwerfen.
 */
async function readSystemLocation(host) {
    try {
        const obj = await host.getForeignObjectAsync?.("system.config");
        const common = obj?.common;
        const lat = (0, state_util_1.asNum)(common?.latitude);
        const lon = (0, state_util_1.asNum)(common?.longitude);
        return { lat, lon };
    }
    catch {
        return { lat: null, lon: null };
    }
}
const PV_SHAPE_HOURLY_PROBE_COUNT = 24;
/**
 * Liest ein BrightSky-artiges rollierendes Stunden-Array (`prefix.NN.timestamp/.cloud_cover/.solar_estimate`).
 * Andere Wetteradapter mit abweichender Struktur liefern hier einfach keine Treffer (fail-closed, kein Fallback).
 */
async function readPvShapeHourlyPoints(host, prefix) {
    if (!prefix.trim())
        return [];
    const indices = Array.from({ length: PV_SHAPE_HOURLY_PROBE_COUNT }, (_, i) => String(i).padStart(2, "0"));
    const rows = await Promise.all(indices.map(async (idx) => {
        const base = `${prefix}.${idx}`;
        const [timestampRaw, cloudPct, solarEstimateKwh] = await Promise.all([
            readForeignStr(host, `${base}.timestamp`),
            readForeignNum(host, `${base}.cloud_cover`),
            readForeignNum(host, `${base}.solar_estimate`),
        ]);
        if (!timestampRaw)
            return null;
        const ms = Date.parse(timestampRaw);
        if (!Number.isFinite(ms))
            return null;
        const point = { hourStartIso: new Date(ms).toISOString(), cloudPct, solarEstimateKwh };
        return point;
    }));
    return rows.filter((r) => r !== null);
}
async function readPvShapeInput(host, timezone) {
    const cfg = (0, pv_shape_config_1.pvShapeConfigFromAdapter)(host.config);
    if (!(0, pv_shape_config_1.pvShapeConfigReady)(cfg))
        return null;
    const [location, hourlyPoints, kwp1, kwp2] = await Promise.all([
        readSystemLocation(host),
        readPvShapeHourlyPoints(host, cfg.brightskyHourlyPrefix),
        readForeignNum(host, cfg.kwpState1),
        readForeignNum(host, cfg.kwpState2),
    ]);
    const capW = kwp1 !== null || kwp2 !== null ? Math.round(((kwp1 ?? 0) + (kwp2 ?? 0)) * 1000) : null;
    return {
        timezone,
        latDeg: location.lat,
        lonDeg: location.lon,
        hourlyPoints,
        capW,
    };
}
function parseHouseLoadForecastJson(raw) {
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || !parsed.segments)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
exports.parseHouseLoadForecastJson = parseHouseLoadForecastJson;
function parseHouseLoadForecastHorizonJson(raw) {
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return null;
        const days = parsed.filter((d) => !!d && typeof d === "object" && !!d.segments);
        return days.length > 0 ? days : null;
    }
    catch {
        return null;
    }
}
exports.parseHouseLoadForecastHorizonJson = parseHouseLoadForecastHorizonJson;
function pvHorizonDays(now, timezone, horizonValues, horizonConfidence) {
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const days = [
        { dayIndex: 0, dateKey: todayKey, correctedKwh: null, confidencePct: null },
        { dayIndex: 1, dateKey: (0, time_1.addDaysToDateKey)(todayKey, 1), correctedKwh: null, confidencePct: null },
    ];
    for (let d = constants_1.PV_HORIZON_EXTENDED_FIRST_DAY; d <= constants_1.PV_HORIZON_DAY_COUNT; d++) {
        const idx = d - constants_1.PV_HORIZON_EXTENDED_FIRST_DAY;
        days.push({
            dayIndex: d - 1,
            dateKey: (0, time_1.addDaysToDateKey)(todayKey, d - 1),
            correctedKwh: horizonValues[idx] ?? null,
            confidencePct: horizonConfidence[idx] ?? null,
        });
    }
    return days;
}
async function collectContributions(host, now, gridForecast) {
    const timezone = (0, config_1.intentAdminConfigFromAdapter)(host.config).timezone;
    const grid = gridForecast ?? (0, grid_1.buildGridSupplyForecast)(await (0, grid_read_1.collectGridSupplyBuildInput)(host, now));
    const [correctedTodayKwh, correctedTomorrowKwh, rawTodayKwh, rawTomorrowKwh, pvConfidence, pvStatus, pvLastUpdate, houseStatus, houseConfidence, forecastTodayRaw, forecastTomorrowRaw, forecastHorizonRaw, houseLastUpdate, weatherStatus, weatherHealth, weatherConfidence, weatherLastUpdate, globalMode,] = await Promise.all([
        readNum(host, "learning.pv_bias.corrected_today_kwh"),
        readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
        readNum(host, "learning.pv_bias.raw_today_kwh"),
        readNum(host, "learning.pv_bias.raw_tomorrow_kwh"),
        readNum(host, "learning.pv_bias.confidence_pct"),
        readStr(host, "learning.pv_bias.status"),
        readStr(host, "learning.pv_bias.last_update_ts"),
        readStr(host, "learning.house_load.status"),
        readNum(host, "learning.house_load.confidence"),
        readStr(host, "learning.house_load.forecast_today_json"),
        readStr(host, "learning.house_load.forecast_tomorrow_json"),
        readStr(host, "learning.house_load.forecast_horizon_json"),
        readStr(host, "learning.house_load.last_update"),
        readStr(host, "learning.weather.status"),
        readStr(host, "learning.weather.health"),
        readNum(host, "learning.weather.confidence_pct"),
        readStr(host, "learning.weather.last_update"),
        readStr(host, "global_modes.active"),
    ]);
    const horizonValues = await Promise.all(Array.from({ length: constants_1.PV_HORIZON_DAY_COUNT - constants_1.PV_HORIZON_EXTENDED_FIRST_DAY + 1 }, (_, i) => readNum(host, `learning.pv_horizon.day${constants_1.PV_HORIZON_EXTENDED_FIRST_DAY + i}.corrected_kwh`)));
    const horizonConfidence = await Promise.all(Array.from({ length: constants_1.PV_HORIZON_DAY_COUNT - constants_1.PV_HORIZON_EXTENDED_FIRST_DAY + 1 }, (_, i) => readNum(host, `learning.pv_horizon.day${constants_1.PV_HORIZON_EXTENDED_FIRST_DAY + i}.confidence_pct`)));
    const horizonDays = pvHorizonDays(now, timezone, horizonValues, horizonConfidence);
    horizonDays[0].correctedKwh = correctedTodayKwh;
    horizonDays[0].confidencePct = pvConfidence;
    horizonDays[1].correctedKwh = correctedTomorrowKwh;
    horizonDays[1].confidencePct = pvConfidence;
    const pvShape = await readPvShapeInput(host, timezone);
    const pvInput = {
        now,
        correctedTodayKwh,
        correctedTomorrowKwh,
        rawTodayKwh,
        rawTomorrowKwh,
        confidencePct: pvConfidence,
        status: pvStatus,
        lastUpdateTs: pvLastUpdate,
        source: "learning.pv_bias",
        horizonDays,
        shape: pvShape,
    };
    const weatherCfg = (0, config_2.weatherConfigFromAdapter)(host.config);
    const tempMetric = weatherCfg.metrics.temp;
    const cloudMetric = weatherCfg.metrics.cloud;
    const [outdoorTempC, cloudPct] = await Promise.all([
        tempMetric
            ? ((await readForeignNum(host, tempMetric.actualStateId)) ??
                (await readForeignNum(host, tempMetric.forecastStateId)))
            : null,
        cloudMetric
            ? ((await readForeignNum(host, cloudMetric.actualStateId)) ??
                (await readForeignNum(host, cloudMetric.forecastStateId)))
            : null,
    ]);
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const weatherHorizonDays = [];
    for (const dayIndex of horizon_1.WEATHER_HORIZON_DAY_INDEXES) {
        const prefix = (0, horizon_1.weatherHorizonDayStatePrefix)(dayIndex);
        const [minTempC, maxTempC, qualityRaw] = await Promise.all([
            readNum(host, `${prefix}.min_temp_c`),
            readNum(host, `${prefix}.max_temp_c`),
            readStr(host, `${prefix}.quality`),
        ]);
        const quality = qualityRaw === "valid" || qualityRaw === "degraded" || qualityRaw === "missing"
            ? qualityRaw
            : minTempC !== null || maxTempC !== null
                ? "degraded"
                : "missing";
        weatherHorizonDays.push({
            dayIndex,
            dateKey: (0, time_1.addDaysToDateKey)(todayKey, dayIndex - 1),
            minTempC,
            maxTempC,
            quality,
        });
    }
    const day1 = weatherHorizonDays.find((d) => d.dayIndex === 1);
    const day2 = weatherHorizonDays.find((d) => d.dayIndex === 2);
    const todayMinTempC = day1 && day1.quality !== "missing" ? day1.minTempC : null;
    const todayMaxTempC = day1 && day1.quality !== "missing" ? day1.maxTempC : null;
    const tomorrowMinTempC = day2 && day2.quality !== "missing" ? day2.minTempC : null;
    const tomorrowMaxTempC = day2 && day2.quality !== "missing" ? day2.maxTempC : null;
    const farthestWeatherDay = weatherHorizonDays
        .filter((d) => d.minTempC !== null || d.maxTempC !== null)
        .map((d) => d.dateKey)
        .sort()
        .at(-1);
    const weatherHorizonEnd = (farthestWeatherDay ?? (0, time_1.addDaysToDateKey)(todayKey, 1)) + "T23:59:59.999Z";
    const hourlyPrefix = (0, pv_shape_config_1.pvShapeConfigFromAdapter)(host.config).brightskyHourlyPrefix;
    const hourlyPoints = await (0, weather_hourly_1.collectWeatherHourlyPoints)(host, now, timezone, hourlyPrefix);
    const constraintInput = {
        now,
        globalMode,
        configuredHouseFuseLimitW: grid.configuredHouseFuseLimitW,
        configuredMaxGridImportW: grid.configuredMaxGridImportW,
        effectiveMaxGridImportW: grid.effectiveMaxGridImportW,
        gridImportAllowed: grid.gridImportAllowed,
        gridSupplyQuality: grid.quality,
    };
    const contributions = [
        (0, pv_1.buildPvContribution)(pvInput),
        (0, house_load_1.buildHouseLoadContribution)({
            now,
            timezone,
            status: houseStatus,
            confidence: houseConfidence,
            forecastToday: parseHouseLoadForecastJson(forecastTodayRaw),
            forecastTomorrow: parseHouseLoadForecastJson(forecastTomorrowRaw),
            forecastHorizon: parseHouseLoadForecastHorizonJson(forecastHorizonRaw),
            lastUpdate: houseLastUpdate,
        }),
        (0, weather_1.buildWeatherContribution)({
            now,
            learningStatus: weatherStatus,
            learningHealth: weatherHealth,
            confidencePct: weatherConfidence,
            lastUpdate: weatherLastUpdate,
            forecastSource: "",
            actualSource: "",
            outdoorTempC,
            cloudPct,
            hourlyPoints,
            todayMinTempC,
            todayMaxTempC,
            tomorrowMinTempC,
            tomorrowMaxTempC,
            horizonDays: weatherHorizonDays,
            forecastHorizonStart: now.toISOString(),
            forecastHorizonEnd: weatherHorizonEnd,
        }),
        (0, constraints_1.buildGridSupplyContribution)(grid),
        (0, constraints_1.buildHouseMainFuseConstraintContribution)(constraintInput),
        (0, constraints_1.buildGlobalConstraintsContribution)(constraintInput),
    ];
    return { now, timezone, gridForecast: grid, contributions, constraintInput };
}
exports.collectContributions = collectContributions;
