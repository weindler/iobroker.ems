"use strict";
/**
 * Climate-Thermal-Learning: Rebuild aus Day-Telemetry (90 Tage).
 * Schreibt nur eigene Persistenz/States — kein Einfluss auf Planung oder Runtime.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadClimateThermalPersist = exports.runClimateThermalLearning = exports.CLIMATE_THERMAL_PERSIST_CATEGORY = void 0;
const constants_1 = require("../../addons/air_conditioning/constants");
const config_1 = require("../../addons/air_conditioning/config");
const time_1 = require("../../operator/time");
const constants_2 = require("../day_telemetry/constants");
const persist_1 = require("../day_telemetry/persist");
const math_1 = require("./math");
const ensure_states_1 = require("./ensure_states");
const persist_2 = require("./persist");
exports.CLIMATE_THERMAL_PERSIST_CATEGORY = "learning/climate_thermal";
function timezoneFromConfig(config) {
    const tz = typeof config?.timezone === "string"
        ? config.timezone.trim()
        : "";
    return tz || "Europe/Berlin";
}
function availabilityFromConfig(config) {
    const units = [];
    for (let i = 1; i <= constants_1.AC_UNIT_COUNT; i++) {
        const cfg = (0, config_1.acUnitConfigFromAdapter)(config, i);
        units.push({
            unitIndex: i,
            enabled: cfg.enabled,
            modesAvailable: (0, config_1.availableAcModePurposes)(cfg),
        });
    }
    return units;
}
async function runClimateThermalLearning(host, opts = {}) {
    const now = opts.now ?? new Date();
    const nowMs = now.getTime();
    const timezone = timezoneFromConfig(host.config);
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const cutoffKey = (0, time_1.addDaysToDateKey)(todayKey, -(constants_2.DAY_TELEMETRY_RETENTION_DAYS - 1));
    const telemetryDir = host.getAbsolutePath(constants_2.DAY_TELEMETRY_CATEGORY);
    const persistDir = host.getAbsolutePath(exports.CLIMATE_THERMAL_PERSIST_CATEGORY);
    let units = {};
    try {
        const allKeys = (await (0, persist_1.listDayTelemetryDateKeys)(telemetryDir)).filter((k) => k >= cutoffKey && k <= todayKey);
        const days = [];
        for (const dateKey of allKeys) {
            const day = await (0, persist_1.readDayTelemetryDay)(telemetryDir, dateKey);
            if (day)
                days.push(day);
        }
        units = (0, math_1.computeClimateThermalModels)(days, availabilityFromConfig(host.config), nowMs);
    }
    catch (e) {
        host.log?.warn?.(`climate_thermal: Learning-Lauf fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
        return (0, persist_2.readClimateThermalPersist)(persistDir);
    }
    const persisted = await (0, persist_2.writeClimateThermalPersist)(persistDir, units);
    try {
        await (0, ensure_states_1.ensureClimateThermalRootStates)(host);
        const models = Object.values(units);
        const usable = models.filter((m) => m.passive.usable || m.cooling.usable || m.heating.usable || m.dehumidify.humidity.usable).length;
        await host.setStateAsync("learning.climate_thermal.units_count", { val: models.length, ack: true });
        await host.setStateAsync("learning.climate_thermal.last_run", {
            val: persisted.generatedAtIso,
            ack: true,
        });
        await host.setStateAsync("learning.climate_thermal.summary_de", {
            val: models.length === 0
                ? "Noch keine Climate-Thermal-Daten."
                : `${models.length} Unit(s), ${usable} mit usable Modell — nur Diagnose, keine Steuerung.`,
            ack: true,
        });
    }
    catch (e) {
        host.log?.warn?.(`climate_thermal: Root-States: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const model of Object.values(units)) {
        try {
            await (0, ensure_states_1.ensureClimateThermalStatesForUnit)(host, model.unitIndex);
            await (0, ensure_states_1.publishClimateThermalUnit)(host, model);
        }
        catch (e) {
            host.log?.warn?.(`climate_thermal: State-Publish unit_${model.unitIndex}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return persisted;
}
exports.runClimateThermalLearning = runClimateThermalLearning;
async function loadClimateThermalPersist(host) {
    return (0, persist_2.readClimateThermalPersist)(host.getAbsolutePath(exports.CLIMATE_THERMAL_PERSIST_CATEGORY));
}
exports.loadClimateThermalPersist = loadClimateThermalPersist;
