"use strict";
/**
 * Boiler-Learning A — Newton/Cycles nur aus Boiler-Sensorhistorie.
 * Keine Puffer-Samples, keine Puffer-Konstanten, kein Fake-emptyAt.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runThermalBoilerLearning = exports.refreshThermalBoilerRemainingCountdown = exports.resolveBoilerTempStateId = void 0;
const state_util_1 = require("../../ems_light/state_util");
const state_write_1 = require("../../policy/core/state_write");
const tree_paths_1 = require("../../tree_paths");
const history_1 = require("../thermal_runtime/history");
const math_1 = require("../thermal_runtime/math");
const config_1 = require("./config");
const ensure_states_1 = require("./ensure_states");
const persist_1 = require("./persist");
const JSON_STATE_LIMIT = 10_000;
function truncateJson(obj) {
    const raw = JSON.stringify(obj);
    if (raw.length <= JSON_STATE_LIMIT)
        return raw;
    return `${raw.slice(0, JSON_STATE_LIMIT - 20)}…truncated"}`;
}
/**
 * Nur `addons.immersion_heater.mapping.boiler_temp_c`.
 * Native Admin `ih_boiler_temp_c_target` und Puffer-Max (`ih_planning_max_temp_c`) sind keine Quelle.
 */
async function resolveBoilerTempStateId(host) {
    const base = (0, tree_paths_1.mappingBase)("immersion_heater", "boiler_temp_c");
    const en = await host.getStateAsync(`${base}.enabled`);
    if (en?.val === false)
        return "";
    const t = await host.getStateAsync(`${base}.target_state`);
    return typeof t?.val === "string" ? t.val.trim() : "";
}
exports.resolveBoilerTempStateId = resolveBoilerTempStateId;
/** Ist-Temperatur nur vom Mapping-Ziel — kein Live-Cache, kein Admin-Alias, kein planningMaxTempC. */
async function readCurrentTemp(host, stateId) {
    if (!stateId)
        return null;
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
function classifyModel(result) {
    if ((result.samples ?? 0) > 0 && result.coolingRateCPerHAvg != null && result.coolingRateCPerHAvg > 0) {
        return "cycle";
    }
    if (result.coolingConstantPerH != null && result.coolingConstantPerH > 0)
        return "newton";
    return "none";
}
function qualityOf(model, samples, hasSource) {
    if (!hasSource)
        return "no_source";
    if (model === "cycle" && samples >= 3)
        return "cycle";
    if (model === "newton" || model === "cycle")
        return "newton_fallback";
    return "insufficient_data";
}
function reasonDeOf(input) {
    if (input.temp === null) {
        return "Boiler-Sensor fehlt — kein Fake-emptyAt; Hard nur bei verfügbarer Live-Temperatur.";
    }
    if (input.model === "cycle") {
        return `Boiler ${input.temp.toFixed(1)} °C — Cycle-Modell (${input.samples} Zyklen) bis Min ${input.emptyThresholdC} °C${input.emptyAt ? `, leer ~${input.emptyAt}` : ""}.`;
    }
    if (input.model === "newton") {
        return `Boiler ${input.temp.toFixed(1)} °C — Newton-Fallback aus Boiler-Verlauf (${input.segments} Segmente, ${input.samples} Zyklen), nicht Puffer.`;
    }
    return `Boiler ${input.temp.toFixed(1)} °C — noch kein belastbares Boiler-Kühlmodell; echte Samples werden gesammelt.`;
}
async function writeBoilerResult(host, result, meta) {
    const model = classifyModel(result);
    const quality = qualityOf(model, result.samples, meta.hasSource);
    const reasonDe = reasonDeOf({
        temp: result.currentTemperatureC,
        model,
        samples: result.samples,
        segments: meta.segments,
        emptyAt: result.estimatedEmptyAt,
        emptyThresholdC: meta.emptyThresholdC,
    });
    await host.setStateAsync("learning.thermal_boiler.status", { val: result.status, ack: true });
    await host.setStateAsync("learning.thermal_boiler.health", { val: result.health, ack: true });
    await host.setStateAsync("learning.thermal_boiler.last_run", { val: meta.lastRun, ack: true });
    await host.setStateAsync("learning.thermal_boiler.last_error", { val: result.lastError, ack: true });
    await host.setStateAsync("learning.thermal_boiler.samples", { val: result.samples, ack: true });
    await host.setStateAsync("learning.thermal_boiler.cooling_rate_c_per_h_avg", {
        val: result.coolingRateCPerHAvg,
        ack: true,
    });
    await host.setStateAsync("learning.thermal_boiler.cooling_k_per_h", {
        val: result.coolingConstantPerH,
        ack: true,
    });
    await host.setStateAsync("learning.thermal_boiler.cooling_asymptote_c", {
        val: result.coolingAsymptoteC,
        ack: true,
    });
    await host.setStateAsync("learning.thermal_boiler.cooling_asymptote_source", {
        val: result.coolingAsymptoteSource ?? "",
        ack: true,
    });
    await host.setStateAsync("learning.thermal_boiler.cooling_segments", { val: meta.segments, ack: true });
    await host.setStateAsync("learning.thermal_boiler.current_temperature_c", {
        val: result.currentTemperatureC,
        ack: true,
    });
    await host.setStateAsync("learning.thermal_boiler.estimated_remaining_hours", {
        val: result.estimatedRemainingHours,
        ack: true,
    });
    await host.setStateAsync("learning.thermal_boiler.estimated_empty_at", {
        val: result.estimatedEmptyAt ?? "",
        ack: true,
    });
    await host.setStateAsync("learning.thermal_boiler.by_day_type_json", {
        val: truncateJson(result.byDayTypeJson),
        ack: true,
    });
    await host.setStateAsync("learning.thermal_boiler.history_json", {
        val: truncateJson(result.historyJson),
        ack: true,
    });
    await host.setStateAsync("learning.thermal_boiler.model", { val: model, ack: true });
    await host.setStateAsync("learning.thermal_boiler.quality", { val: quality, ack: true });
    await host.setStateAsync("learning.thermal_boiler.vessel", { val: "boiler", ack: true });
    await host.setStateAsync("learning.thermal_boiler.hard_relevance", { val: model !== "none", ack: true });
    await host.setStateAsync("learning.thermal_boiler.soft_relevance", { val: false, ack: true });
    await (0, state_write_1.setStateIfChanged)(host, "learning.thermal_boiler.reason_de", reasonDe);
}
async function refreshThermalBoilerRemainingCountdown(host) {
    try {
        const st = await host.getStateAsync("learning.thermal_boiler.estimated_empty_at");
        const raw = typeof st?.val === "string" ? st.val.trim() : "";
        if (!raw)
            return;
        const live = (0, math_1.liveRemainingHoursFromEmptyAt)(raw, new Date());
        if (live === null)
            return;
        await host.setStateAsync("learning.thermal_boiler.estimated_remaining_hours", { val: live, ack: true });
    }
    catch {
        /* Diagnose */
    }
}
exports.refreshThermalBoilerRemainingCountdown = refreshThermalBoilerRemainingCountdown;
async function runThermalBoilerLearning(host) {
    await (0, ensure_states_1.ensureThermalBoilerLearningStates)(host);
    const cfg = (0, config_1.thermalBoilerConfigFromAdapter)(host.config);
    const now = new Date();
    const lastRun = now.toISOString();
    const stateId = await resolveBoilerTempStateId(host);
    const currentTempC = await readCurrentTemp(host, stateId);
    if (!cfg.enabled) {
        await writeBoilerResult(host, {
            status: "disabled",
            health: "no_source",
            samples: 0,
            runtimeHoursAvg: null,
            runtimeHoursMedian: null,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: null,
            coolingAsymptoteC: null,
            coolingAsymptoteSource: null,
            currentTemperatureC: currentTempC,
            estimatedRemainingHours: null,
            estimatedEmptyAt: null,
            bySeasonJson: {},
            byDayTypeJson: {},
            historyJson: [],
            sourceStateId: stateId,
            lastError: "Thermal Learning in Admin deaktiviert.",
        }, { lastRun, segments: 0, hasSource: Boolean(stateId), emptyThresholdC: cfg.emptyThresholdC });
        return;
    }
    if (!stateId) {
        await writeBoilerResult(host, {
            status: "no_source",
            health: "no_source",
            samples: 0,
            runtimeHoursAvg: null,
            runtimeHoursMedian: null,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: null,
            coolingAsymptoteC: null,
            coolingAsymptoteSource: null,
            currentTemperatureC: null,
            estimatedRemainingHours: null,
            estimatedEmptyAt: null,
            bySeasonJson: {},
            byDayTypeJson: {},
            historyJson: [],
            sourceStateId: "",
            lastError: "Keine Boiler-Temperaturquelle — addons.immersion_heater.mapping.boiler_temp_c.",
        }, { lastRun, segments: 0, hasSource: false, emptyThresholdC: cfg.emptyThresholdC });
        return;
    }
    let points = [];
    if (stateId && host.getHistoryAsync) {
        try {
            const fetched = await (0, history_1.fetchTemperatureHistory)({ getHistoryAsync: host.getHistoryAsync }, stateId, cfg.lookbackDays);
            points = fetched.points;
        }
        catch (e) {
            host.log?.warn?.(`Boiler-Learning Historie: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    const cycles = (0, math_1.detectRuntimeCycles)(points, cfg);
    const coolingSegments = (0, math_1.collectCoolingSegments)(points, cfg.minRuntimeHours);
    const activeCoolingRateCPerH = (0, math_1.estimateActiveCoolingRateCPerH)(points, cfg);
    const coolingModel = (0, math_1.estimateCoolingModel)(points, cfg);
    const hist = (0, math_1.summarizeTempHistory)(points, cfg.emptyThresholdC);
    const result = (0, math_1.computeThermalRuntimeLearning)({
        cycles,
        currentTempC,
        cfg: { ...cfg, temperatureStateId: stateId },
        sourceStateId: stateId,
        now,
        activeCoolingRateCPerH,
        coolingConstantPerH: coolingModel.coolingConstantPerH,
        asymptoteC: coolingModel.asymptoteC,
        asymptoteSource: coolingModel.asymptoteSource,
    });
    if (host.getAbsolutePath && stateId) {
        await (0, persist_1.writeThermalBoilerPersist)(host.getAbsolutePath("learning/thermal_boiler"), result, lastRun, stateId);
    }
    await writeBoilerResult(host, result, {
        lastRun,
        segments: coolingSegments.length,
        hasSource: Boolean(stateId) || currentTempC !== null,
        emptyThresholdC: cfg.emptyThresholdC,
    });
    host.log?.debug?.(`Boiler-Learning: status=${result.status} model=${classifyModel(result)} cycles=${result.samples} segments=${coolingSegments.length} k=${coolingModel.coolingConstantPerH ?? "—"}/h remaining=${result.estimatedRemainingHours ?? "—"}h hist=${hist.minC ?? "—"}–${hist.maxC ?? "—"}°C floor=${cfg.emptyThresholdC}°C`);
}
exports.runThermalBoilerLearning = runThermalBoilerLearning;
