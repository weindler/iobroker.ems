import { mappingBase } from "../../tree_paths";

export type ThermalMappingHost = {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
};

export type ResolvedThermalSource = {
	stateId: string;
	sourceKind: "admin" | "immersion_mapping" | "none";
};

/** Admin-State oder addons.immersion_heater.mapping.buffer_temp_c — keine harte Pfad-Annahme. */
export async function resolveThermalTemperatureStateId(
	host: ThermalMappingHost,
	configuredStateId: string,
): Promise<ResolvedThermalSource> {
	if (configuredStateId) {
		return { stateId: configuredStateId, sourceKind: "admin" };
	}

	const base = mappingBase("immersion_heater", "buffer_temp_c");
	const enabledSt = await host.getStateAsync(`${base}.enabled`);
	if (enabledSt?.val === false) {
		return { stateId: "", sourceKind: "none" };
	}
	const targetSt = await host.getStateAsync(`${base}.target_state`);
	const targetId = typeof targetSt?.val === "string" ? targetSt.val.trim() : "";
	if (!targetId) {
		return { stateId: "", sourceKind: "none" };
	}
	return { stateId: targetId, sourceKind: "immersion_mapping" };
}
