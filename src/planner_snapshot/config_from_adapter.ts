import { acGlobalConfigFromAdapter } from "../addons/air_conditioning/config";
import { AC_UNIT_COUNT } from "../addons/air_conditioning/constants";
import { batteryConfigFromAdapter, batteryProfileIdFromConfig } from "../addons/battery/config";
import { immersionDeviceConfigFromAdapter } from "../addons/immersion_heater/device_config";
import { wallboxEvccTelemetryConfigFromAdapter } from "../addons/wallbox/evcc_config";
import { intentAdminConfigFromAdapter } from "../intent/config";
import { priceForecastConfigFromAdapter } from "../learning/price_forecast/config";
import { weatherConfigFromAdapter } from "../learning/weather/config";
import { PERSIST_CATEGORY as CONSUMER_STATS_PERSIST } from "../learning/consumer_stats";
import { globalPolicyConfigFromAdapter } from "../policy/global/config";
import { batteryWinterPlanConfigFromAdapter } from "../planner/battery_winter_config";
import type { PlannerRelevantConfig, PlannerWeatherMetricRefs } from "./source";

const CREDENTIAL_KEY_RE =
	/(password|passwd|token|secret|api[_-]?key|credential|certificate|private[_-]?key|auth)/i;

function configRecord(config: unknown): Record<string, unknown> {
	return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

function strField(c: Record<string, unknown>, key: string): string | null {
	if (CREDENTIAL_KEY_RE.test(key)) return null;
	const v = c[key];
	if (v === null || v === undefined) return null;
	return typeof v === "string" ? v : String(v);
}

function metricRefs(
	forecastStateId: string | undefined,
	actualStateId: string | undefined,
): PlannerWeatherMetricRefs | null {
	const forecast = forecastStateId?.trim() || null;
	const actual = actualStateId?.trim() || null;
	if (!forecast && !actual) return null;
	return { forecastStateId: forecast, actualStateId: actual };
}

export interface PlannerConfigPathHost {
	config: unknown;
	getAbsolutePath?: (category?: string) => string;
}

/** Whitelisted, serializable planner config — never returns native adapter config. */
export function plannerRelevantConfigFromHost(host: PlannerConfigPathHost): PlannerRelevantConfig {
	const c = configRecord(host.config);
	const intent = intentAdminConfigFromAdapter(host.config);
	const price = priceForecastConfigFromAdapter(host.config);
	const weather = weatherConfigFromAdapter(host.config);
	const immersion = immersionDeviceConfigFromAdapter(host.config);
	const winter = batteryWinterPlanConfigFromAdapter(host.config);
	const battery = batteryConfigFromAdapter(host.config);
	const policy = globalPolicyConfigFromAdapter(host.config);
	const evcc = wallboxEvccTelemetryConfigFromAdapter(host.config);
	const ac = acGlobalConfigFromAdapter(host.config);

	const executionModeRaw = strField(c, "global_execution_mode");
	const executionMode = executionModeRaw?.trim().toLowerCase() || null;

	const acUnits = Array.from({ length: AC_UNIT_COUNT }, (_, i) => {
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
		batteryProfileId: batteryProfileIdFromConfig(host.config),
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
			consumerStatsDir: host.getAbsolutePath?.(CONSUMER_STATS_PERSIST) ?? null,
		},
	};
}
