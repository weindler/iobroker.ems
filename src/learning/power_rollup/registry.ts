import { batteryConfigFromAdapter } from "../../addons/battery/config";
import { batteryRuntimeConfigFromAdapter } from "../battery_runtime/config";
import { mappingBase } from "../../tree_paths";
import type { DensePowerSourceDef, ResolvedDensePowerSource } from "./types";

export const DENSE_POWER_SOURCES: readonly DensePowerSourceDef[] = [
	{ sourceKey: "battery.power_w", addonId: "battery", role: "power_w" },
] as const;

export type PowerRollupRegistryHost = {
	config: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
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

export async function resolveDensePowerSources(
	host: PowerRollupRegistryHost,
): Promise<ResolvedDensePowerSource[]> {
	const powerInvert = resolveBatteryPowerInvert(host.config);
	const learning = batteryRuntimeConfigFromAdapter(host.config);
	const out: ResolvedDensePowerSource[] = [];

	for (const def of DENSE_POWER_SOURCES) {
		let stateId = "";
		if (def.sourceKey === "battery.power_w" && learning.powerStateId) {
			stateId = learning.powerStateId;
		}
		if (!stateId) {
			stateId = await resolveMappedRole(host, def.addonId, def.role);
		}
		if (!stateId) {
			continue;
		}
		out.push({
			...def,
			stateId,
			powerInvert,
		});
	}

	return out;
}
