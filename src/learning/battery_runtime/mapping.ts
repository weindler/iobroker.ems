import { mappingBase } from "../../tree_paths";

export type BatteryMappingHost = {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
};

export type ResolvedBatterySources = {
	socStateId: string;
	powerStateId: string;
	capacityStateId: string;
	secondsSinceFullStateId: string;
};

async function resolveMappedRole(
	host: BatteryMappingHost,
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

/** Admin-States oder addons.battery.mapping — keine harten Geräte-Pfade. */
export async function resolveBatteryRuntimeSources(
	host: BatteryMappingHost,
	configured: {
		socStateId: string;
		powerStateId: string;
		capacityStateId: string;
		secondsSinceFullStateId: string;
	},
): Promise<ResolvedBatterySources> {
	const socStateId =
		configured.socStateId || (await resolveMappedRole(host, "battery", "soc_pct"));
	const capacityStateId =
		configured.capacityStateId ||
		(await resolveMappedRole(host, "battery", "capacity_kwh"));
	const secondsSinceFullStateId =
		configured.secondsSinceFullStateId ||
		(await resolveMappedRole(host, "battery", "seconds_since_full_charge"));
	// Leistung: Admin oder addons.battery.mapping.power_w (kein charging_power_w — oft Sollwert).
	const powerStateId =
		configured.powerStateId || (await resolveMappedRole(host, "battery", "power_w"));

	return {
		socStateId,
		powerStateId,
		capacityStateId,
		secondsSinceFullStateId,
	};
}
