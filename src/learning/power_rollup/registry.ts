import { batteryConfigFromAdapter } from "../../addons/battery/config";
import { batteryRuntimeConfigFromAdapter } from "../battery_runtime/config";
import { DEFAULT_LOOKBACK_DAYS as HOUSE_DEFAULT_LOOKBACK } from "../house_load/constants";
import { houseLoadConfigFromAdapter } from "../house_load/config";
import { detectPowerUnit, resolveHouseLoadPowerUnit } from "../house_load/history";
import { mappingBase } from "../../tree_paths";
import { DEFAULT_LOOKBACK_DAYS } from "../battery_runtime/constants";
import type { DensePowerSourceDef, ResolvedDensePowerSource } from "./types";

export const DENSE_POWER_SOURCES: readonly DensePowerSourceDef[] = [
	{ sourceKey: "battery.power_w", addonId: "battery", role: "power_w", rollupMode: "bidirectional_max" },
	{
		sourceKey: "battery.consumption_w",
		addonId: "battery",
		role: "consumption_w",
		rollupMode: "unidirectional_avg",
	},
] as const;

export type PowerRollupRegistryHost = {
	config: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
};

async function resolveMappedRole(
	host: PowerRollupRegistryHost,
	addonId: string,
	role: string,
): Promise<string> {
	const base = mappingBase(addonId, role);
	const enabledSt = await host.getStateAsync(`${base}.enabled`);
	if (enabledSt?.val === false) {
		return "";
	}
	const targetSt = await host.getStateAsync(`${base}.target_state`);
	return typeof targetSt?.val === "string" ? targetSt.val.trim() : "";
}

function rec(config: unknown): Record<string, unknown> {
	return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

/** EMS-Normalisierung: + laden, − entladen (Sonnen pacTotal → invert). */
export function resolveBatteryPowerInvert(config: unknown): boolean {
	const learning = batteryRuntimeConfigFromAdapter(config);
	if (learning.powerInvert) {
		return true;
	}
	const bat = batteryConfigFromAdapter(config);
	if (bat.signConvention === "positive_discharge") {
		return true;
	}
	const signRaw = String(rec(config).battery_power_sign_convention ?? "")
		.trim()
		.toLowerCase();
	if (signRaw === "") {
		return bat.profile === "sonnen_em";
	}
	return false;
}

function lookbackDaysForSource(config: unknown, def: DensePowerSourceDef): number {
	if (def.sourceKey === "battery.consumption_w") {
		const hl = houseLoadConfigFromAdapter(config);
		return hl.lookbackDays > 0 ? hl.lookbackDays : HOUSE_DEFAULT_LOOKBACK;
	}
	const br = batteryRuntimeConfigFromAdapter(config);
	return br.lookbackDays > 0 ? br.lookbackDays : DEFAULT_LOOKBACK_DAYS;
}

async function resolvePowerUnit(
	host: PowerRollupRegistryHost,
	stateId: string,
): Promise<"W" | "kW"> {
	if (host.getObjectAsync) {
		return resolveHouseLoadPowerUnit(host, stateId);
	}
	return detectPowerUnit(stateId);
}

export async function resolveDensePowerSources(
	host: PowerRollupRegistryHost,
): Promise<ResolvedDensePowerSource[]> {
	const powerInvert = resolveBatteryPowerInvert(host.config);
	const batteryLearning = batteryRuntimeConfigFromAdapter(host.config);
	const houseLearning = houseLoadConfigFromAdapter(host.config);
	const out: ResolvedDensePowerSource[] = [];

	for (const def of DENSE_POWER_SOURCES) {
		let stateId = "";
		if (def.sourceKey === "battery.power_w" && batteryLearning.powerStateId) {
			stateId = batteryLearning.powerStateId;
		}
		if (def.sourceKey === "battery.consumption_w" && houseLearning.powerStateId) {
			stateId = houseLearning.powerStateId;
		}
		if (!stateId) {
			stateId = await resolveMappedRole(host, def.addonId, def.role);
		}
		if (!stateId) {
			continue;
		}
		const powerUnit =
			def.rollupMode === "unidirectional_avg"
				? await resolvePowerUnit(host, stateId)
				: "W";
		out.push({
			...def,
			stateId,
			lookbackDays: lookbackDaysForSource(host.config, def),
			powerInvert: def.rollupMode === "bidirectional_max" ? powerInvert : false,
			powerUnit,
		});
	}

	return out;
}
