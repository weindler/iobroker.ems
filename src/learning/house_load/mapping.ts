import { resolveMappingTargetFromConfig } from "../../mapping_resolve";

export type HouseLoadMappingHost = {
	config?: unknown;
};

export type ResolvedHouseLoadSource = {
	stateId: string;
	sourceKind: "admin" | "battery_mapping" | "none";
};

/** Admin-State oder native Batterie-Mapping consumption_w. */
export async function resolveHouseLoadPowerStateId(
	host: HouseLoadMappingHost,
	configuredStateId: string,
): Promise<ResolvedHouseLoadSource> {
	if (configuredStateId) {
		return { stateId: configuredStateId, sourceKind: "admin" };
	}
	const mapped = resolveMappingTargetFromConfig(host.config, "battery", "consumption_w");
	if (!mapped || !mapped.enabled) {
		return { stateId: "", sourceKind: "none" };
	}
	return { stateId: mapped.targetState, sourceKind: "battery_mapping" };
}
