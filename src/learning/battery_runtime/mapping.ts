import { resolveMappingTargetFromConfig } from "../../mapping_resolve";
import { houseLoadConfigFromAdapter } from "../house_load/config";

export type BatteryMappingHost = {
	config?: unknown;
};

export type ResolvedBatterySources = {
	socStateId: string;
	powerStateId: string;
	capacityStateId: string;
	secondsSinceFullStateId: string;
	pvAcPowerStateId: string;
	consumptionStateId: string;
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
	const houseLearning = houseLoadConfigFromAdapter(host.config);
	const consumptionMapped = mappedTarget(host, "consumption_w");
	return {
		socStateId: configured.socStateId || mappedTarget(host, "soc_pct"),
		capacityStateId: configured.capacityStateId || mappedTarget(host, "capacity_kwh"),
		secondsSinceFullStateId:
			configured.secondsSinceFullStateId || mappedTarget(host, "seconds_since_full_charge"),
		powerStateId: configured.powerStateId || mappedTarget(host, "power_w"),
		pvAcPowerStateId: mappedTarget(host, "pv_ac_power_w"),
		/** House-Load-Learning-State hat Vorrang, sonst Batterie-Mapping consumption_w. */
		consumptionStateId: houseLearning.powerStateId || consumptionMapped,
	};
}
