import { resolveMappingTargetFromConfig } from "../../mapping_resolve";

export type BatteryMappingHost = {
	config?: unknown;
};

export type ResolvedBatterySources = {
	socStateId: string;
	powerStateId: string;
	capacityStateId: string;
	secondsSinceFullStateId: string;
};

function mappedTarget(host: BatteryMappingHost, role: string): string {
	const mapped = resolveMappingTargetFromConfig(host.config, "battery", role);
	if (!mapped || !mapped.enabled) {
		return "";
	}
	return mapped.targetState;
}

/** Admin-States oder native Batterie-Mappings — keine ioBroker-Spiegel. */
export async function resolveBatteryRuntimeSources(
	host: BatteryMappingHost,
	configured: {
		socStateId: string;
		powerStateId: string;
		capacityStateId: string;
		secondsSinceFullStateId: string;
	},
): Promise<ResolvedBatterySources> {
	return {
		socStateId: configured.socStateId || mappedTarget(host, "soc_pct"),
		capacityStateId: configured.capacityStateId || mappedTarget(host, "capacity_kwh"),
		secondsSinceFullStateId:
			configured.secondsSinceFullStateId || mappedTarget(host, "seconds_since_full_charge"),
		powerStateId: configured.powerStateId || mappedTarget(host, "power_w"),
	};
}
