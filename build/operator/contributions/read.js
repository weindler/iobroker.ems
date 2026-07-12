"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectContributions = exports.parseHouseLoadForecastJson = void 0;
const state_util_1 = require("../../ems_light/state_util");
const config_1 = require("../../intent/config");
const config_2 = require("../../learning/weather/config");
const constants_1 = require("../../learning/pv_horizon/constants");
const persist_1 = require("../../learning/house_load/persist");
const paths_1 = require("../../backup_integration/paths");
const path = __importStar(require("node:path"));
const time_1 = require("../time");
const pv_1 = require("./pv");
const house_load_1 = require("./house_load");
const weather_1 = require("./weather");
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
async function readHouseLoadForecastsFromFile(host) {
    try {
        const layout = (0, paths_1.resolveEmsPaths)(host);
        const persist = await (0, persist_1.readHouseLoadPersist)(path.join(layout.durableDataDir, "learning/house_load"));
        if (!persist)
            return null;
        return {
            status: persist.health?.status ?? "ready",
            confidence: persist.confidence ?? null,
            forecastToday: persist.forecast_today ?? null,
            forecastTomorrow: persist.forecast_tomorrow ?? null,
            lastUpdate: persist.generated_at ?? null,
        };
    }
    catch {
        return null;
    }
}
async function collectContributions(host, now, gridForecast) {
    const timezone = (0, config_1.intentAdminConfigFromAdapter)(host.config).timezone;
    const grid = gridForecast ?? (0, grid_1.buildGridSupplyForecast)(await (0, grid_read_1.collectGridSupplyBuildInput)(host, now));
    const [correctedTodayKwh, correctedTomorrowKwh, rawTodayKwh, rawTomorrowKwh, pvConfidence, pvStatus, pvLastUpdate, weatherStatus, weatherHealth, weatherConfidence, weatherLastUpdate, weatherForecastSource, weatherActualSource, globalMode,] = await Promise.all([
        readNum(host, "learning.pv_bias.corrected_today_kwh"),
        readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
        readNum(host, "learning.pv_bias.raw_today_kwh"),
        readNum(host, "learning.pv_bias.raw_tomorrow_kwh"),
        readNum(host, "learning.pv_bias.confidence_pct"),
        readStr(host, "learning.pv_bias.status"),
        readStr(host, "learning.pv_bias.last_update_ts"),
        readStr(host, "learning.weather.status"),
        readStr(host, "learning.weather.health"),
        readNum(host, "learning.weather.confidence_pct"),
        readStr(host, "learning.weather.last_update"),
        readStr(host, "learning.weather.forecast_source"),
        readStr(host, "learning.weather.actual_source"),
        readStr(host, "global_modes.active"),
    ]);
    const houseFromFile = await readHouseLoadForecastsFromFile(host);
    const houseStatus = houseFromFile?.status ?? (await readStr(host, "learning.house_load.status"));
    const houseConfidence = houseFromFile?.confidence ?? (await readNum(host, "learning.house_load.confidence"));
    const forecastTodayRaw = houseFromFile?.forecastToday != null
        ? JSON.stringify(houseFromFile.forecastToday)
        : await readStr(host, "learning.house_load.forecast_today_json");
    const forecastTomorrowRaw = houseFromFile?.forecastTomorrow != null
        ? JSON.stringify(houseFromFile.forecastTomorrow)
        : await readStr(host, "learning.house_load.forecast_tomorrow_json");
    const houseLastUpdate = houseFromFile?.lastUpdate ?? (await readStr(host, "learning.house_load.last_update"));
    const horizonValues = await Promise.all(Array.from({ length: constants_1.PV_HORIZON_DAY_COUNT - constants_1.PV_HORIZON_EXTENDED_FIRST_DAY + 1 }, (_, i) => readNum(host, `learning.pv_horizon.day${constants_1.PV_HORIZON_EXTENDED_FIRST_DAY + i}.corrected_kwh`)));
    const horizonConfidence = await Promise.all(Array.from({ length: constants_1.PV_HORIZON_DAY_COUNT - constants_1.PV_HORIZON_EXTENDED_FIRST_DAY + 1 }, (_, i) => readNum(host, `learning.pv_horizon.day${constants_1.PV_HORIZON_EXTENDED_FIRST_DAY + i}.confidence_pct`)));
    const horizonDays = pvHorizonDays(now, timezone, horizonValues, horizonConfidence);
    horizonDays[0].correctedKwh = correctedTodayKwh;
    horizonDays[0].confidencePct = pvConfidence;
    horizonDays[1].correctedKwh = correctedTomorrowKwh;
    horizonDays[1].confidencePct = pvConfidence;
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
    const hourlyPoints = [];
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
            lastUpdate: houseLastUpdate,
        }),
        (0, weather_1.buildWeatherContribution)({
            now,
            learningStatus: weatherStatus,
            learningHealth: weatherHealth,
            confidencePct: weatherConfidence,
            lastUpdate: weatherLastUpdate,
            forecastSource: weatherForecastSource,
            actualSource: weatherActualSource,
            outdoorTempC,
            cloudPct,
            hourlyPoints,
            todayMinTempC: null,
            todayMaxTempC: outdoorTempC,
            tomorrowMinTempC: null,
            tomorrowMaxTempC: null,
            forecastHorizonStart: now.toISOString(),
            forecastHorizonEnd: (0, time_1.addDaysToDateKey)((0, time_1.localDateKeyInTimezone)(now, timezone), 1) + "T23:59:59.999Z",
        }),
        (0, constraints_1.buildGridSupplyContribution)(grid),
        (0, constraints_1.buildHouseMainFuseConstraintContribution)(constraintInput),
        (0, constraints_1.buildGlobalConstraintsContribution)(constraintInput),
    ];
    return { now, timezone, gridForecast: grid, contributions, constraintInput };
}
exports.collectContributions = collectContributions;
