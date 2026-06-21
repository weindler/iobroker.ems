import { mappingBase } from "../../tree_paths";

export type HouseLoadMappingHost = {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
};

export type ResolvedHouseLoadSource = {
	stateId: string;
	sourceKind: "admin" | "battery_mapping" | "none";
};

/** Admin-State oder addons.battery.mapping.consumption_w — keine harte Pfad-Annahme. */
export async function resolveHouseLoadPowerStateId(
	host: HouseLoadMappingHost,
	configuredStateId: string,
): Promise<ResolvedHouseLoadSource> {
	if (configuredStateId) {
		return { stateId: configuredStateId, sourceKind: "admin" };
	}

	const base = mappingBase("battery", "consumption_w");
	const enabledSt = await host.getStateAsync(`${base}.enabled`);
	if (enabledSt?.val === false) {
		return { stateId: "", sourceKind: "none" };
	}
	const targetSt = await host.getStateAsync(`${base}.target_state`);
	const targetId = typeof targetSt?.val === "string" ? targetSt.val.trim() : "";
	if (!targetId) {
		return { stateId: "", sourceKind: "none" };
	}
	return { stateId: targetId, sourceKind: "battery_mapping" };
}
