import { addonAvailable, addonEnabled } from "../../tree_paths";
import type { StateHost } from "../../ems_light/state_util";

export async function isAddonIntentActive(host: StateHost, addonId: string): Promise<boolean> {
	try {
		const enabled = await host.getStateAsync(addonEnabled(addonId));
		const available = await host.getStateAsync(addonAvailable(addonId));
		if (enabled?.val === false) {
			return false;
		}
		if (available?.val === false) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}
