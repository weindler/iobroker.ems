import { isAddonGovernanceEnabledFromState } from "../../addons/governance";
import { addonAvailable } from "../../tree_paths";
import type { StateHost } from "../../ems_light/state_util";

export async function isAddonIntentActive(host: StateHost, addonId: string): Promise<boolean> {
	try {
		const enabled = await isAddonGovernanceEnabledFromState(
			(id) => host.getStateAsync(id),
			addonId,
		);
		if (!enabled) {
			return false;
		}
		const available = await host.getStateAsync(addonAvailable(addonId));
		if (available?.val === false) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}
