"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWeatherLearning = void 0;
const config_1 = require("./config");
const history_1 = require("./history");
const math_1 = require("./math");
const persist_1 = require("./persist");
async function setNumIfValid(host, id, value) {
    if (value !== null && Number.isFinite(value)) {
        await host.setStateAsync(id, { val: Math.round(value * 1000) / 1000, ack: true });
    }
}
function joinFields(keys) {
    return keys.join(",");
}
async function writeWeatherResult(host, result) {
    await setNumIfValid(host, "learning.weather.temp_bias_c", result.tempBiasC);
    await setNumIfValid(host, "learning.weather.cloud_bias_pct", result.cloudBiasPct);
    await setNumIfValid(host, "learning.weather.rain_bias_mm", result.rainBiasMm);
    await setNumIfValid(host, "learning.weather.wind_bias_kmh", result.windBiasKmh);
    await setNumIfValid(host, "learning.weather.confidence_pct", result.confidencePct);
    await setNumIfValid(host, "learning.weather.sample_days_7d", result.sampleDays7d);
    await setNumIfValid(host, "learning.weather.sample_days_30d", result.sampleDays30d);
    await host.setStateAsync("learning.weather.status", { val: result.status, ack: true });
    await host.setStateAsync("learning.weather.health", { val: result.health, ack: true });
    await host.setStateAsync("learning.weather.quality_level", { val: result.qualityLevel, ack: true });
    await host.setStateAsync("learning.weather.valid_fields", { val: joinFields(result.validFields), ack: true });
    await host.setStateAsync("learning.weather.missing_fields", {
        val: joinFields(result.missingFields),
        ack: true,
    });
    await host.setStateAsync("learning.weather.forecast_source", { val: result.forecastSource, ack: true });
    await host.setStateAsync("learning.weather.actual_source", { val: result.actualSource, ack: true });
    await host.setStateAsync("learning.weather.summary_yesterday", { val: result.summaryYesterday, ack: true });
    await host.setStateAsync("learning.weather.error", { val: result.error, ack: true });
    await host.setStateAsync("learning.weather.last_update", {
        val: new Date().toISOString(),
        ack: true,
    });
}
function resolveSources(cfg) {
    const first = Object.values(cfg.metrics)[0];
    if (!first) {
        return { forecastSource: "", actualSource: "" };
    }
    return {
        forecastSource: (0, config_1.sourceLabelFromStateId)(first.forecastStateId),
        actualSource: (0, config_1.sourceLabelFromStateId)(first.actualStateId),
    };
}
async function runWeatherLearning(host) {
    const cfg = (0, config_1.weatherConfigFromAdapter)(host.config);
    const { forecastSource, actualSource } = resolveSources(cfg);
    if (!cfg.enabled) {
        await host.setStateAsync("learning.weather.status", { val: "disabled", ack: true });
        await host.setStateAsync("learning.weather.error", {
            val: "Weather Learning in Admin deaktiviert.",
            ack: true,
        });
        return;
    }
    if (!(0, config_1.weatherConfigReady)(cfg)) {
        const result = (0, math_1.errorResult)(forecastSource, actualSource, "Mindestens ein Forecast-/Ist-Mapping in Admin konfigurieren.");
        result.status = "missing_mapping";
        await writeWeatherResult(host, result);
        return;
    }
    try {
        const dayResults = await (0, history_1.fetchWeatherDayResults)(host, cfg.metrics, 30);
        const yesterday = dayResults.find((d) => d.dayOffset === 1) ?? null;
        const result = (0, math_1.computeWeatherLearning)(dayResults, cfg.metrics, yesterday, forecastSource, actualSource);
        await writeWeatherResult(host, result);
        if (yesterday && host.getAbsolutePath) {
            const baseDir = host.getAbsolutePath("learning/weather");
            await (0, persist_1.writeWeatherDayPersist)(baseDir, (0, persist_1.dayResultToPersist)(yesterday, forecastSource, actualSource));
        }
        host.log.info(`Weather-Learning: status=${result.status} health=${result.health} confidence=${result.confidence} samples7d=${result.sampleDays7d}`);
        if (result.missingFields.length > 0) {
            const recent = dayResults.filter((d) => d.dayOffset <= 6);
            for (const key of result.missingFields) {
                const noForecast = recent.filter((d) => d.missingForecast.includes(key)).length;
                const noActual = recent.filter((d) => d.missingActual.includes(key)).length;
                const fc = cfg.metrics[key]?.forecastStateId ?? "—";
                const act = cfg.metrics[key]?.actualStateId ?? "—";
                const side = noForecast >= noActual
                    ? `Forecast fehlt (${fc}, ${noForecast}/7 Tage ohne Stundenwerte)`
                    : `Ist fehlt (${act}, ${noActual}/7 Tage ohne Stundenwerte)`;
                host.log.warn(`Weather-Learning: '${key}' ohne Bias — ${side}; history.0 auf dem State prüfen.`);
            }
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        host.log.error(`Weather-Learning: ${msg}`);
        const result = (0, math_1.errorResult)(forecastSource, actualSource, msg);
        await writeWeatherResult(host, result);
    }
}
exports.runWeatherLearning = runWeatherLearning;
