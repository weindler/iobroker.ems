"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plannerRelevantConfigFromHost = void 0;
const config_1 = require("../addons/air_conditioning/config");
const constants_1 = require("../addons/air_conditioning/constants");
const config_2 = require("../addons/battery/config");
const device_config_1 = require("../addons/immersion_heater/device_config");
const evcc_config_1 = require("../addons/wallbox/evcc_config");
const config_3 = require("../intent/config");
const config_4 = require("../learning/price_forecast/config");
const config_5 = require("../learning/weather/config");
const consumer_stats_1 = require("../learning/consumer_stats");
const config_6 = require("../policy/global/config");
const battery_winter_config_1 = require("../planner/battery_winter_config");
const CREDENTIAL_KEY_RE = /(password|passwd|token|secret|api[_-]?key|credential|certificate|private[_-]?key|auth)/i;
function configRecord(config) {
    return config && typeof config === "object" ? config : {};
}
function strField(c, key) {
    if (CREDENTIAL_KEY_RE.test(key))
        return null;
    const v = c[key];
    if (v === null || v === undefined)
        return null;
    return typeof v === "string" ? v : String(v);
}
function metricRefs(forecastStateId, actualStateId) {
    const forecast = forecastStateId?.trim() || null;
    const actual = actualStateId?.trim() || null;
    if (!forecast && !actual)
        return null;
    return { forecastStateId: forecast, actualStateId: actual };
}
/** Whitelisted, serializable planner config — never returns native adapter config. */
function plannerRelevantConfigFromHost(host) {
    const c = configRecord(host.config);
    const intent = (0, config_3.intentAdminConfigFromAdapter)(host.config);
    const price = (0, config_4.priceForecastConfigFromAdapter)(host.config);
    const weather = (0, config_5.weatherConfigFromAdapter)(host.config);
    const immersion = (0, device_config_1.immersionDeviceConfigFromAdapter)(host.config);
    const winter = (0, battery_winter_config_1.batteryWinterPlanConfigFromAdapter)(host.config);
    const battery = (0, config_2.batteryConfigFromAdapter)(host.config);
    const policy = (0, config_6.globalPolicyConfigFromAdapter)(host.config);
    const evcc = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(host.config);
    const ac = (0, config_1.acGlobalConfigFromAdapter)(host.config);
    const executionModeRaw = strField(c, "global_execution_mode");
    const executionMode = executionModeRaw?.trim().toLowerCase() || null;
    const acUnits = Array.from({ length: constants_1.AC_UNIT_COUNT }, (_, i) => {
        const index = i + 1;
        const unit = ac.units.find((u) => u.index === index);
        return {
            index,
            enabled: unit?.enabled ?? false,
            targetTempC: unit ? unit.coolingSetpointC : null,
        };
    });
    const tempMetric = weather.metrics.temp;
    const cloudMetric = weather.metrics.cloud;
    return {
        timezone: intent.timezone,
        executionMode,
        batteryProfileId: (0, config_2.batteryProfileIdFromConfig)(host.config),
        batteryCapacityManualKwh: battery.capacityManualKwh,
        wallboxEvccEnabledStateId: evcc.enabledStateId.trim() || null,
        priceForecastTodayStateId: price.todayJsonStateId.trim() || null,
        priceForecastTomorrowStateId: price.tomorrowJsonStateId.trim() || null,
        immersion: {
            forecastModeEnabled: immersion.forecastModeEnabled,
            planningMaxTempC: immersion.planningMaxTempC,
            minRuntimeMin: Math.round(immersion.minimumRuntimeSec / 60),
            minPauseMin: Math.round(immersion.minimumPauseSec / 60),
            stages: immersion.stages.map((s) => ({
                index: s.index,
                enabled: s.enabled,
                nominalPowerW: s.nominalPowerW,
                label: s.name || null,
            })),
        },
        batteryWinter: {
            enabled: winter.enabled,
            horizonDays: winter.horizonDays,
            socTargetMinPct: winter.minSocPct,
            socTargetMaxPct: winter.maxSocPct,
        },
        acUnits,
        weather: {
            temp: tempMetric
                ? metricRefs(tempMetric.forecastStateId, tempMetric.actualStateId)
                : null,
            cloud: cloudMetric
                ? metricRefs(cloudMetric.forecastStateId, cloudMetric.actualStateId)
                : null,
        },
        adminPolicy: {
            gridImportAllowed: policy.gridImportAllowed ?? true,
            maxGridImportW: policy.maxGridImportW,
            houseFuseLimitW: policy.houseFuseLimitW,
            energyPriority: policy.energyPriority ?? [],
            mutualExclusions: policy.mutualExclusions ?? [],
        },
        dataPaths: {
            houseLoadLearningDir: host.getAbsolutePath?.("learning/house_load") ?? null,
            thermalRuntimeLearningDir: host.getAbsolutePath?.("learning/thermal_runtime") ?? null,
            consumerStatsDir: host.getAbsolutePath?.(consumer_stats_1.PERSIST_CATEGORY) ?? null,
        },
    };
}
exports.plannerRelevantConfigFromHost = plannerRelevantConfigFromHost;
