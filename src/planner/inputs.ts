import { acGlobalConfigFromAdapter } from "../addons/air_conditioning/config";
import { acUnitConsumerKey } from "../addons/air_conditioning/constants";
import { acUnitRuntimeBase } from "../addons/air_conditioning/runtime/ensure_states";
import { isAddonGovernanceEnabledFromState } from "../addons/governance";
import { immersionDeviceConfigFromAdapter } from "../addons/immersion_heater/device_config";
import { parseResolvedIntentJson, resolvedModeFromIntent } from "../addons/immersion_heater/runtime/intent_read";
import { WALLBOX_EVCC_STATES } from "../addons/wallbox/ensure_evcc_states";
import { addonGovernanceAiAllowedState } from "../addons/governance/ensure_states";
import { batteryWinterPlanConfigFromAdapter } from "./battery_winter_config";
import { readBatteryWinterDays } from "./battery_winter_inputs";
import { parseResolvedBatteryIntentJson } from "../addons/battery/runtime/intent_read";
import type { ImmersionDeviceConfig } from "../addons/immersion_heater/runtime/types";
import { readConsumerStatsPersist } from "../learning/consumer_stats/persist";
import { PERSIST_CATEGORY as CONSUMER_STATS_PERSIST } from "../learning/consumer_stats";
import type { ConsumerStatsPersist } from "../learning/consumer_stats/types";
import { weatherConfigFromAdapter } from "../learning/weather/config";
import type { StateHost } from "../ems_light/state_util";
import { asNum } from "../ems_light/state_util";

import type { AcGlobalConfig } from "../addons/air_conditioning/types";
import type { GlobalMode } from "../global_modes/constants";
import type { PlannerModePolicy } from "./mode_policy";
import { plannerModePolicyFromGlobalMode } from "./mode_policy";
import type { CoolingUnitPlanInput } from "./rules/cooling";
import type { BatteryWinterDayInput } from "./rules/battery_winter";
import type { BatteryWinterPlanConfig } from "./battery_winter_config";

export const PLANNER_SURPLUS_MIN_W = 400;
export const PLANNER_BATTERY_TARGET_SOC_PCT = 95;
export const PLANNER_BATTERY_MIN_SURPLUS_W = 500;

export interface PlannerInputs {
	now: Date;
	globalMode: GlobalMode;
	modePolicy: PlannerModePolicy;
	pvPowerW: number | null;
	houseLoadW: number | null;
	socPct: number | null;
	bufferTempC: number | null;
	thermalMode: "off" | "auto" | "force";
	thermalGovernanceEnabled: boolean;
	batteryGovernanceEnabled: boolean;
	evccBatteryMode: string | null;
	evccBatteryDischargeControl: boolean | null;
	userIntentBatteryHold: boolean;
	userIntentBatteryCharge: boolean;
	immersionConfig: ImmersionDeviceConfig;
	pvTodayKwh: number | null;
	pvTomorrowKwh: number | null;
	pvBiasStatus: string | null;
	forecastModeEnabled: boolean;
	aiOptimizationAllowed: boolean;
	acConfig: AcGlobalConfig;
	coolingGovernanceEnabled: boolean;
	outdoorTempC: number | null;
	coolingUnits: CoolingUnitPlanInput[];
	batteryWinterConfig: BatteryWinterPlanConfig;
	batteryWinterDays: BatteryWinterDayInput[];
	snowCoverSuspected: boolean;
	batteryAiAllowed: boolean;
}

export type PlannerHost = StateHost & {
	config?: unknown;
	getAbsolutePath?: (category?: string) => string;
	log?: { warn?: (msg: string) => void; debug?: (msg: string) => void };
};

async function readNum(host: StateHost, id: string): Promise<number | null> {
	try {
		const st = await host.getStateAsync(id);
		return asNum(st?.val);
	} catch {
		return null;
	}
}

async function readStr(host: StateHost, id: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(id);
		if (st?.val == null || String(st.val).trim() === "") return null;
		return String(st.val).trim();
	} catch {
		return null;
	}
}

async function readBool(host: StateHost, id: string): Promise<boolean | null> {
	try {
		const st = await host.getStateAsync(id);
		if (st?.val == null) return null;
		if (typeof st.val === "boolean") return st.val;
		const s = String(st.val).trim().toLowerCase();
		if (s === "true" || s === "1") return true;
		if (s === "false" || s === "0") return false;
		return null;
	} catch {
		return null;
	}
}

async function readConsumerStatsForPlanner(host: PlannerHost): Promise<ConsumerStatsPersist | null> {
	const dir = host.getAbsolutePath?.(CONSUMER_STATS_PERSIST);
	if (!dir) {
		return null;
	}
	try {
		return await readConsumerStatsPersist(dir);
	} catch {
		return null;
	}
}

async function readOutdoorTempC(host: PlannerHost): Promise<number | null> {
	const weather = weatherConfigFromAdapter(host.config);
	const tempMetric = weather.metrics.temp;
	if (!tempMetric) {
		return null;
	}
	const actual = await readNum(host, tempMetric.actualStateId);
	if (actual !== null) {
		return actual;
	}
	return readNum(host, tempMetric.forecastStateId);
}

async function readCoolingUnitInputs(
	host: PlannerHost,
	acConfig: AcGlobalConfig,
	persist: ConsumerStatsPersist | null,
): Promise<CoolingUnitPlanInput[]> {
	const rows: CoolingUnitPlanInput[] = [];
	for (const unit of acConfig.units) {
		if (!unit.enabled) {
			continue;
		}
		const roomTempC = await readNum(host, `${acUnitRuntimeBase(unit.index)}.room_temp_c`);
		const consumerKey = acUnitConsumerKey(unit.index);
		rows.push({
			unit,
			roomTempC,
			consumerStats: persist?.consumers[consumerKey],
		});
	}
	return rows;
}

export async function readPlannerInputs(host: PlannerHost): Promise<PlannerInputs> {
	const now = new Date();
	const acConfig = acGlobalConfigFromAdapter(host.config);
	const pvFromPv = await readNum(host, "live.pv.power_w");
	const pvFromBattery = await readNum(host, "live.battery.pv_ac_power_w");
	const pvPowerW = pvFromPv ?? pvFromBattery;

	const thermalRaw = await host.getStateAsync("user_intent.thermal.resolved_json");
	const thermalIntent = parseResolvedIntentJson(thermalRaw?.val);
	const thermalMode = resolvedModeFromIntent(thermalIntent);

	const batteryRaw = await host.getStateAsync("user_intent.battery.resolved_json");
	const batteryIntent = parseResolvedBatteryIntentJson(batteryRaw?.val);
	const userIntentBatteryHold =
		batteryIntent?.operating_request.status === "valid" &&
		batteryIntent.operating_request.value === "hold";
	const userIntentBatteryCharge =
		batteryIntent?.operating_request.status === "valid" &&
		batteryIntent.operating_request.value === "charge";

	const globalModeRaw = await readStr(host, "global_modes.active");
	const modePolicy = plannerModePolicyFromGlobalMode(globalModeRaw);

	const immersionConfig = immersionDeviceConfigFromAdapter(host.config);
	const consumerStatsPersist = await readConsumerStatsForPlanner(host);

	const batteryWinterConfig = batteryWinterPlanConfigFromAdapter(host.config);

	const [thermalGov, batteryGov, coolingGov, houseLoadW, socPct, bufferTempC, evccMode, evccDischarge, pvTodayKwh, pvTomorrowKwh, pvBiasStatus, aiThermalAllowed, batteryAiAllowed, snowCover, outdoorTempC, coolingUnits, batteryWinterDays] =
		await Promise.all([
			isAddonGovernanceEnabledFromState((id) => host.getStateAsync(id), "immersion_heater"),
			isAddonGovernanceEnabledFromState((id) => host.getStateAsync(id), "battery"),
			isAddonGovernanceEnabledFromState((id) => host.getStateAsync(id), "climate"),
			readNum(host, "live.battery.house_load_w"),
			readNum(host, "live.battery.soc_pct"),
			readNum(host, "live.thermal.buffer_temp_c"),
			readStr(host, WALLBOX_EVCC_STATES.batteryMode),
			readBool(host, WALLBOX_EVCC_STATES.batteryDischargeControl),
			readNum(host, "learning.pv_bias.corrected_today_kwh"),
			readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
			readStr(host, "learning.pv_bias.status"),
			readBool(host, addonGovernanceAiAllowedState("immersion_heater")),
			readBool(host, addonGovernanceAiAllowedState("battery")),
			readBool(host, "ems_mirror.snow_cover_suspected"),
			readOutdoorTempC(host),
			readCoolingUnitInputs(host, acConfig, consumerStatsPersist),
			readBatteryWinterDays(host, batteryWinterConfig.horizonDays),
		]);

	return {
		now,
		globalMode: modePolicy.mode,
		modePolicy,
		pvPowerW,
		houseLoadW,
		socPct,
		bufferTempC,
		thermalMode,
		thermalGovernanceEnabled: thermalGov,
		batteryGovernanceEnabled: batteryGov,
		evccBatteryMode: evccMode,
		evccBatteryDischargeControl: evccDischarge,
		userIntentBatteryHold,
		userIntentBatteryCharge,
		immersionConfig,
		pvTodayKwh,
		pvTomorrowKwh,
		pvBiasStatus,
		forecastModeEnabled: immersionConfig.forecastModeEnabled,
		aiOptimizationAllowed: aiThermalAllowed === true,
		acConfig,
		coolingGovernanceEnabled: coolingGov,
		outdoorTempC,
		coolingUnits,
		batteryWinterConfig,
		batteryWinterDays,
		snowCoverSuspected: snowCover === true,
		batteryAiAllowed: batteryAiAllowed === true,
	};
}

export async function readPlannerThermalStage(host: StateHost): Promise<number> {
	const n = await readNum(host, "planner.intent.thermal.commanded_stage");
	if (n === null || !Number.isFinite(n)) return 0;
	return Math.max(0, Math.round(n));
}

export async function readPlannerThermalTargetTemp(host: StateHost): Promise<number | null> {
	return readNum(host, "planner.intent.thermal.target_temp_c");
}
