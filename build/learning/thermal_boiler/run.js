"use strict";
/**
 * Boiler-Learning A — Newton/Cycles nur aus Boiler-Sensorhistorie.
 * Keine Puffer-Samples, keine Puffer-Konstanten, kein Fake-emptyAt.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runThermalBoilerLearning = exports.__resetThermalBoilerRunLockForTest = exports.refreshThermalBoilerRemainingCountdown = exports.resolveBoilerTempStateId = void 0;
const state_util_1 = require("../../ems_light/state_util");
const state_write_1 = require("../../policy/core/state_write");
const mapping_resolve_1 = require("../../mapping_resolve");
const history_1 = require("../thermal_runtime/history");
const math_1 = require("../thermal_runtime/math");
const config_1 = require("./config");
const ensure_states_1 = require("./ensure_states");
const persist_1 = require("./persist");
const samples_1 = require("./samples");
const config_2 = require("../pv_bias/config");
const JSON_STATE_LIMIT = 10_000;
function truncateJson(obj) {
    const raw = JSON.stringify(obj);
    if (raw.length <= JSON_STATE_LIMIT)
        return raw;
    return `${raw.slice(0, JSON_STATE_LIMIT - 20)}…truncated"}`;
}
/**
 * Native Mapping `ih_boiler_temp_c_*` — nicht Puffer, nicht planningMax, nicht Live-Cache.
 */
async function resolveBoilerTempStateId(host) {
    const mapped = (0, mapping_resolve_1.resolveMappingTargetFromConfig)(host.config, "immersion_heater", "boiler_temp_c");
    if (!mapped || !mapped.enabled)
        return "";
    return mapped.targetState;
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
    await host.setStateAsync("learning.thermal_boiler.last_sample_at", { val: meta.lastSampleAt, ack: true });
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
    await host.setStateAsync("learning.thermal_boiler.model", { val: model, ack: true });
    await host.setStateAsync("learning.thermal_boiler.quality", { val: quality, ack: true });
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
let boilerRunInFlight = false;
function nextRunIso(now, host) {
    const intervalSec = (0, config_2.pvBiasConfigFromAdapter)(host.config).intervalSec;
    return new Date(now.getTime() + intervalSec * 1000).toISOString();
}
function emptyBoilerCompute(input) {
    return {
        status: input.status,
        health: input.health,
        samples: 0,
        runtimeHoursAvg: null,
        runtimeHoursMedian: null,
        coolingRateCPerHAvg: null,
        coolingConstantPerH: null,
        coolingAsymptoteC: null,
        coolingAsymptoteSource: null,
        currentTemperatureC: input.currentTemperatureC,
        estimatedRemainingHours: null,
        estimatedEmptyAt: null,
        bySeasonJson: {},
        byDayTypeJson: {},
        historyJson: [],
        sourceStateId: input.sourceStateId,
        lastError: input.lastError,
    };
}
function resultMeta(host, now, over) {
    return {
        lastRun: now.toISOString(),
        nextRun: nextRunIso(now, host),
        ...over,
    };
}
/** Nur für Tests: Overlap-Lock zurücksetzen. */
function __resetThermalBoilerRunLockForTest() {
    boilerRunInFlight = false;
}
exports.__resetThermalBoilerRunLockForTest = __resetThermalBoilerRunLockForTest;
async function runThermalBoilerLearning(host, opts = {}) {
    if (boilerRunInFlight)
        return;
    boilerRunInFlight = true;
    try {
        await runThermalBoilerLearningInner(host, opts);
    }
    finally {
        boilerRunInFlight = false;
    }
}
exports.runThermalBoilerLearning = runThermalBoilerLearning;
async function runThermalBoilerLearningInner(host, opts) {
    await (0, ensure_states_1.ensureThermalBoilerLearningStates)(host);
    const cfg = (0, config_1.thermalBoilerConfigFromAdapter)(host.config);
    const now = opts.nowMs != null ? new Date(opts.nowMs) : new Date();
    const trigger = opts.trigger ?? "learning_tick";
    const historyTimeoutMs = opts.historyTimeoutMs ?? samples_1.BOILER_HISTORY_FETCH_TIMEOUT_MS;
    const stateId = await resolveBoilerTempStateId(host);
    const currentTempC = await readCurrentTemp(host, stateId);
    const metaBase = {
        emptyThresholdC: cfg.emptyThresholdC,
        trigger,
        lastSampleAt: currentTempC != null ? now.toISOString() : "",
        historyPoints: 0,
        segments: 0,
        hasSource: Boolean(stateId),
    };
    if (!cfg.enabled) {
        await writeBoilerResult(host, emptyBoilerCompute({
            status: "disabled",
            health: "no_source",
            currentTemperatureC: currentTempC,
            sourceStateId: stateId,
            lastError: "Thermal Learning in Admin deaktiviert.",
        }), resultMeta(host, now, { ...metaBase, hasSource: Boolean(stateId) }));
        return;
    }
    if (!stateId) {
        await writeBoilerResult(host, emptyBoilerCompute({
            status: "no_source",
            health: "no_source",
            currentTemperatureC: null,
            sourceStateId: "",
            lastError: "Keine Boiler-Temperaturquelle — ih_boiler_temp_c_target.",
        }), resultMeta(host, now, { ...metaBase, hasSource: false, lastSampleAt: "" }));
        return;
    }
    /*
     * Sofort live schreiben — darf nicht hinter 90-Tage-History-Queue warten.
     * Sonst bleibt ein Alt-Diagnosewert (z. B. 63 °C) nach Adapterstart stehen.
     */
    await writeBoilerResult(host, emptyBoilerCompute({
        status: "insufficient_data",
        health: "no_samples",
        currentTemperatureC: currentTempC,
        sourceStateId: stateId,
        lastError: "",
    }), resultMeta(host, now, { ...metaBase, hasSource: true }));
    let storedSamples = [];
    if (host.getAbsolutePath) {
        const persist = await (0, persist_1.readThermalBoilerPersist)(host.getAbsolutePath("learning/thermal_boiler"));
        storedSamples = persist?.temp_samples ?? [];
    }
    if (currentTempC != null) {
        storedSamples = (0, samples_1.appendBoilerTempSample)(storedSamples, { ts: now.getTime(), tempC: currentTempC }, now.getTime(), cfg.lookbackDays);
    }
    let historyPoints = [];
    if (host.getHistoryAsync) {
        try {
            const historyLookbackDays = Math.min(cfg.lookbackDays, samples_1.BOILER_HISTORY_FETCH_LOOKBACK_DAYS);
            const fetched = await (0, samples_1.withTimeoutFallback)((0, history_1.fetchTemperatureHistory)({ getHistoryAsync: host.getHistoryAsync }, stateId, historyLookbackDays), historyTimeoutMs, { points: [], lastValidTs: null });
            historyPoints = fetched.points;
        }
        catch (e) {
            host.log?.warn?.(`Boiler-Learning Historie: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    const points = (0, samples_1.trimBoilerTempSamples)((0, samples_1.mergeBoilerTempPoints)(storedSamples, historyPoints), now.getTime(), cfg.lookbackDays);
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
    if (host.getAbsolutePath) {
        await (0, persist_1.writeThermalBoilerPersist)(host.getAbsolutePath("learning/thermal_boiler"), result, now.toISOString(), stateId, points);
    }
    const lastSample = points.length > 0 ? points[points.length - 1] : null;
    await writeBoilerResult(host, result, resultMeta(host, now, {
        segments: coolingSegments.length,
        hasSource: true,
        emptyThresholdC: cfg.emptyThresholdC,
        historyPoints: points.length,
        lastSampleAt: lastSample ? new Date(lastSample.ts).toISOString() : currentTempC != null ? now.toISOString() : "",
        trigger,
        historyJsonOverride: (0, samples_1.historyJsonFromBoilerPoints)(points),
    }));
    host.log?.debug?.(`Boiler-Learning: status=${result.status} model=${classifyModel(result)} cycles=${result.samples} points=${points.length} segments=${coolingSegments.length} k=${coolingModel.coolingConstantPerH ?? "—"}/h remaining=${result.estimatedRemainingHours ?? "—"}h hist=${hist.minC ?? "—"}–${hist.maxC ?? "—"}°C floor=${cfg.emptyThresholdC}°C trigger=${trigger}`);
}
