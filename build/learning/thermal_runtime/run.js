"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runThermalRuntimeLearning = void 0;
const state_util_1 = require("../../ems_light/state_util");
const config_1 = require("./config");
const history_1 = require("./history");
const mapping_1 = require("./mapping");
const math_1 = require("./math");
const persist_1 = require("./persist");
const JSON_STATE_LIMIT = 10_000;
function truncateJson(obj) {
    const raw = JSON.stringify(obj);
    if (raw.length <= JSON_STATE_LIMIT) {
        return raw;
    }
    return `${raw.slice(0, JSON_STATE_LIMIT - 20)}…truncated"}`;
}
async function setNumIfValid(host, id, value) {
    if (value !== null && Number.isFinite(value)) {
        await host.setStateAsync(id, { val: value, ack: true });
    }
}
async function readCurrentTemp(host, stateId) {
    try {
        const st = host.getForeignStateAsync
            ? await host.getForeignStateAsync(stateId)
            : await host.getStateAsync(stateId);
        const n = (0, state_util_1.asNum)(st?.val);
        return (0, history_1.isValidTempC)(n) ? n : null;
    }
    catch {
        return null;
    }
}
async function writeResult(host, result, lastRun) {
    await host.setStateAsync("learning.thermal_runtime.status", { val: result.status, ack: true });
    await host.setStateAsync("learning.thermal_runtime.health", { val: result.health, ack: true });
    await host.setStateAsync("learning.thermal_runtime.last_run", { val: lastRun, ack: true });
    await host.setStateAsync("learning.thermal_runtime.last_error", { val: result.lastError, ack: true });
    await setNumIfValid(host, "learning.thermal_runtime.samples", result.samples);
    await setNumIfValid(host, "learning.thermal_runtime.runtime_hours_avg", result.runtimeHoursAvg);
    await setNumIfValid(host, "learning.thermal_runtime.runtime_hours_median", result.runtimeHoursMedian);
    await setNumIfValid(host, "learning.thermal_runtime.cooling_rate_c_per_h_avg", result.coolingRateCPerHAvg);
    await setNumIfValid(host, "learning.thermal_runtime.cooling_k_per_h", result.coolingConstantPerH);
    await setNumIfValid(host, "learning.thermal_runtime.cooling_asymptote_c", result.coolingAsymptoteC);
    await host.setStateAsync("learning.thermal_runtime.cooling_asymptote_source", {
        val: result.coolingAsymptoteSource ?? "",
        ack: true,
    });
    await setNumIfValid(host, "learning.thermal_runtime.current_temperature_c", result.currentTemperatureC);
    await setNumIfValid(host, "learning.thermal_runtime.estimated_remaining_hours", result.estimatedRemainingHours);
    await host.setStateAsync("learning.thermal_runtime.estimated_empty_at", {
        val: result.estimatedEmptyAt ?? "",
        ack: true,
    });
    await host.setStateAsync("learning.thermal_runtime.by_season_json", {
        val: truncateJson(result.bySeasonJson),
        ack: true,
    });
    await host.setStateAsync("learning.thermal_runtime.by_day_type_json", {
        val: truncateJson(result.byDayTypeJson),
        ack: true,
    });
    await host.setStateAsync("learning.thermal_runtime.history_json", {
        val: truncateJson(result.historyJson),
        ack: true,
    });
}
async function runThermalRuntimeLearning(host) {
    const cfg = (0, config_1.thermalRuntimeConfigFromAdapter)(host.config);
    const now = new Date();
    const lastRun = now.toISOString();
    if (!cfg.enabled) {
        await writeResult(host, (0, math_1.disabledResult)(), lastRun);
        return;
    }
    if (!(0, config_1.configIsValid)(cfg)) {
        await writeResult(host, (0, math_1.invalidConfigResult)(""), lastRun);
        return;
    }
    const resolved = await (0, mapping_1.resolveThermalTemperatureStateId)(host, cfg.temperatureStateId);
    if (!resolved.stateId) {
        await writeResult(host, (0, math_1.noSourceResult)(), lastRun);
        return;
    }
    try {
        const currentTempC = await readCurrentTemp(host, resolved.stateId);
        const { points } = await (0, history_1.fetchTemperatureHistory)(host, resolved.stateId, cfg.lookbackDays);
        const histSummary = (0, math_1.summarizeTempHistory)(points, cfg.emptyThresholdC);
        const cycles = (0, math_1.detectRuntimeCycles)(points, cfg);
        const coolingSegments = (0, math_1.collectCoolingSegments)(points, cfg.minRuntimeHours);
        const activeCoolingRateCPerH = (0, math_1.estimateActiveCoolingRateCPerH)(points, cfg);
        const coolingModel = (0, math_1.estimateCoolingModel)(points, cfg);
        const result = (0, math_1.computeThermalRuntimeLearning)({
            cycles,
            currentTempC,
            cfg,
            sourceStateId: resolved.stateId,
            now,
            activeCoolingRateCPerH,
            coolingConstantPerH: coolingModel.coolingConstantPerH,
            asymptoteC: coolingModel.asymptoteC,
            asymptoteSource: coolingModel.asymptoteSource,
        });
        if (host.getAbsolutePath) {
            await (0, persist_1.writeThermalRuntimePersist)(host.getAbsolutePath("learning/thermal_runtime"), result, lastRun);
        }
        await writeResult(host, result, lastRun);
        host.log.info(`Thermal-Runtime-Learning: status=${result.status} health=${result.health} cycles=${result.samples} source=${(0, config_1.sourceLabelFromStateId)(resolved.stateId)} k=${coolingModel.coolingConstantPerH ?? "—"}/h asym=${coolingModel.asymptoteC}°C(${coolingModel.asymptoteSource}) active_rate=${activeCoolingRateCPerH ?? "—"}°C/h (cooling_segments=${coolingSegments.length}) remaining=${result.estimatedRemainingHours ?? "—"}h`);
        if (result.status === "insufficient_data") {
            host.log.warn(`Thermal Runtime Learning: ungenügende Zyklen (samples=${result.samples}, history_points=${points.length}, temp=${histSummary.minC ?? "—"}–${histSummary.maxC ?? "—"}°C, floor=${cfg.emptyThresholdC}°C, above_floor=${histSummary.pointsAboveFloor})`);
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        host.log.error(`Thermal Runtime Learning: ${msg}`);
        await writeResult(host, (0, math_1.errorResult)(msg, resolved.stateId), lastRun);
    }
}
exports.runThermalRuntimeLearning = runThermalRuntimeLearning;
