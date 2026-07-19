import { ensureAddonMappingStates, mappingCommandsFromEntries, syncNativeMappingToStates } from "../../mapping_sync";
import {
	dynamicTariffMappingFromConfig,
} from "./mapping_config";

export const DYNAMIC_TARIFF_ADDON_ID = "dynamic_tariff";

export async function initDynamicTariffModule(adapter: ioBroker.Adapter): Promise<null> {
	const cfg =
		adapter.config && typeof adapter.config === "object"
			? (adapter.config as Record<string, unknown>)
			: {};
	await ensureAddonMappingStates(
		adapter,
		DYNAMIC_TARIFF_ADDON_ID,
		mappingCommandsFromEntries(dynamicTariffMappingFromConfig(cfg)),
	);
	await syncNativeMappingToStates(adapter, DYNAMIC_TARIFF_ADDON_ID, dynamicTariffMappingFromConfig);
	adapter.log.debug("dynamic_tariff: read-only price mapping");
	return null;
}
