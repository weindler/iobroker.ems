export type { AddonGovernance, GovernedAddonId } from "./types";
export {
	GOVERNED_ADDON_REGISTRY,
	governedAddonEntry,
	governedAddonByRuntimeId,
	governedAddonIds,
	isGovernedAddonId,
} from "./registry";
export {
	boolField,
	getAddonGovernance,
	isAddonEnabled,
	isAddonAiOptimizationAllowed,
	resolveGovernedAddonId,
} from "./config";
export {
	addonGovernanceBase,
	addonGovernanceEnabledState,
	addonGovernanceAiAllowedState,
	ensureAddonGovernanceStates,
	syncAddonGovernanceFromConfig,
	isAddonGovernanceEnabledFromState,
} from "./ensure_states";
