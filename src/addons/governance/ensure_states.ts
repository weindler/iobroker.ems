import { setStateIfChanged } from "../../policy/core/state_write";
import type { StateHost } from "../../ems_light/state_util";
import { addonEnabled } from "../../tree_paths";
import { getAddonGovernance, resolveGovernedAddonId } from "./config";
import { GOVERNED_ADDON_REGISTRY } from "./registry";
import type { GovernedAddonId } from "./types";

export function addonGovernanceBase(addonId: GovernedAddonId): string {
	return `addons.${addonId}.governance`;
}

export function addonGovernanceEnabledState(addonId: GovernedAddonId): string {
	return `${addonGovernanceBase(addonId)}.enabled`;
}

export function addonGovernanceAiAllowedState(addonId: GovernedAddonId): string {
	return `${addonGovernanceBase(addonId)}.ai_optimization_allowed`;
}

export async function ensureAddonGovernanceStates(host: StateHost): Promise<void> {
	for (const entry of GOVERNED_ADDON_REGISTRY) {
		await host.setObjectNotExistsAsync(`addons.${entry.id}`, {
			type: "channel",
			common: { name: entry.displayNameDe },
			native: {},
		} as ioBroker.Object);
		await host.setObjectNotExistsAsync(addonGovernanceBase(entry.id), {
			type: "channel",
			common: { name: `${entry.displayNameDe} Governance` },
			native: {},
		} as ioBroker.Object);

		for (const def of [
			{
				id: addonGovernanceEnabledState(entry.id),
				name: `${entry.displayNameDe}: aktiv (Governance)`,
			},
			{
				id: addonGovernanceAiAllowedState(entry.id),
				name: `${entry.displayNameDe}: KI-Optimierung erlaubt`,
			},
		]) {
			await host.setObjectNotExistsAsync(def.id, {
				type: "state",
				common: {
					name: def.name,
					type: "boolean",
					role: "switch",
					read: true,
					write: false,
				},
				native: {},
			} as ioBroker.Object);
		}
	}
}

export async function syncAddonGovernanceFromConfig(host: StateHost, config: unknown): Promise<void> {
	for (const entry of GOVERNED_ADDON_REGISTRY) {
		const gov = getAddonGovernance(config, entry.id);
		await setStateIfChanged(host, addonGovernanceEnabledState(entry.id), gov.enabled);
		await setStateIfChanged(host, addonGovernanceAiAllowedState(entry.id), gov.aiOptimizationAllowed);
		await setStateIfChanged(host, addonEnabled(entry.runtimeAddonId), gov.enabled);
	}
}

export async function isAddonGovernanceEnabledFromState(
	getState: (id: string) => Promise<ioBroker.State | null | undefined>,
	addonOrRuntimeId: string,
): Promise<boolean> {
	const governedId = resolveGovernedAddonId(addonOrRuntimeId);
	if (governedId) {
		const st = await getState(addonGovernanceEnabledState(governedId));
		if (st?.val === false) {
			return false;
		}
		if (st?.val === true) {
			return true;
		}
	}
	const st = await getState(addonEnabled(addonOrRuntimeId));
	return st?.val !== false;
}
