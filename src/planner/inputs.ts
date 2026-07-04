import type { ImmersionDeviceConfig } from "../addons/immersion_heater/runtime/types";
import { immersionDeviceConfigFromAdapter } from "../addons/immersion_heater/device_config";
import { parseResolvedIntentJson, resolvedModeFromIntent } from "../addons/immersion_heater/runtime/intent_read";
import { WALLBOX_EVCC_STATES } from "../addons/wallbox/ensure_evcc_states";
import { isAddonGovernanceEnabledFromState } from "../addons/governance";
import { parseResolvedBatteryIntentJson } from "../addons/battery/runtime/intent_read";
import type { StateHost } from "../ems_light/state_util";
import { asNum } from "../ems_light/state_util";

import type { GlobalMode } from "../global_modes/constants";
import type { PlannerModePolicy } from "./mode_policy";
import { plannerModePolicyFromGlobalMode } from "./mode_policy";

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
}

export type PlannerHost = StateHost & {
	config?: unknown;
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

export async function readPlannerInputs(host: PlannerHost): Promise<PlannerInputs> {
	const now = new Date();
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

	const [thermalGov, batteryGov, houseLoadW, socPct, bufferTempC, evccMode, evccDischarge] = await Promise.all([
		isAddonGovernanceEnabledFromState((id) => host.getStateAsync(id), "immersion_heater"),
		isAddonGovernanceEnabledFromState((id) => host.getStateAsync(id), "battery"),
		readNum(host, "live.battery.house_load_w"),
		readNum(host, "live.battery.soc_pct"),
		readNum(host, "live.thermal.buffer_temp_c"),
		readStr(host, WALLBOX_EVCC_STATES.batteryMode),
		readBool(host, WALLBOX_EVCC_STATES.batteryDischargeControl),
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
		immersionConfig: immersionDeviceConfigFromAdapter(host.config),
	};
}

export async function readPlannerThermalStage(host: StateHost): Promise<number> {
	const n = await readNum(host, "planner.intent.thermal.commanded_stage");
	if (n === null || !Number.isFinite(n)) return 0;
	return Math.max(0, Math.round(n));
}
