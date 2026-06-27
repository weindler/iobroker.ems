import { GLOBAL_MODES, type GlobalMode } from "./constants";
import type { GlobalModeProfile } from "./types";

export const GLOBAL_MODE_PROFILES: Record<GlobalMode, GlobalModeProfile> = {
	off: {
		mode: "off",
		flexibleOptimization: false,
		economyWeight: 0.5,
		comfortWeight: 0.5,
		shiftTolerance: 0,
		gridImportFactor: 0.5,
		userDemandPriority: false,
	},
	eco: {
		mode: "eco",
		flexibleOptimization: true,
		economyWeight: 0.9,
		comfortWeight: 0.4,
		shiftTolerance: 0.8,
		gridImportFactor: 0.6,
		userDemandPriority: false,
	},
	balanced: {
		mode: "balanced",
		flexibleOptimization: true,
		economyWeight: 0.6,
		comfortWeight: 0.6,
		shiftTolerance: 0.5,
		gridImportFactor: 1,
		userDemandPriority: false,
	},
	comfort: {
		mode: "comfort",
		flexibleOptimization: true,
		economyWeight: 0.4,
		comfortWeight: 0.9,
		shiftTolerance: 0.2,
		gridImportFactor: 1.1,
		userDemandPriority: false,
	},
	forced: {
		mode: "forced",
		flexibleOptimization: true,
		economyWeight: 0.3,
		comfortWeight: 0.7,
		shiftTolerance: 0.1,
		gridImportFactor: 1.2,
		userDemandPriority: true,
	},
};

export function availableModesJson(): string {
	return JSON.stringify(
		GLOBAL_MODES.map((mode) => ({
			mode,
			label: mode,
			profile: GLOBAL_MODE_PROFILES[mode],
		})),
	);
}

export function profileForMode(mode: GlobalMode): GlobalModeProfile {
	return GLOBAL_MODE_PROFILES[mode];
}
