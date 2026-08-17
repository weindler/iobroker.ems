export const DYNAMIC_TARIFF_ADDON_ID = "dynamic_tariff";

export async function initDynamicTariffModule(adapter: ioBroker.Adapter): Promise<null> {
	adapter.log.debug("dynamic_tariff: price mapping from adapter config");
	return null;
}
