import { resolveMappingTargetFromConfig } from "../../mapping_resolve";

export type ThermalMappingHost = {
	config?: unknown;
};

export type ResolvedThermalSource = {
	stateId: string;
	sourceKind: "admin" | "immersion_mapping" | "none";
};

/** Admin-State oder native Heizstab-Mapping buffer_temp_c. */
export async function resolveThermalTemperatureStateId(
	host: ThermalMappingHost,
	configuredStateId: string,
): Promise<ResolvedThermalSource> {
	if (configuredStateId) {
		return { stateId: configuredStateId, sourceKind: "admin" };
	}
	const mapped = resolveMappingTargetFromConfig(host.config, "immersion_heater", "buffer_temp_c");
	if (!mapped || !mapped.enabled) {
		return { stateId: "", sourceKind: "none" };
	}
	return { stateId: mapped.targetState, sourceKind: "immersion_mapping" };
}
