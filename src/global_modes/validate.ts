import type { GlobalModeProfile, GlobalModeResolution } from "./types";

export function validateGlobalModeProfile(profile: GlobalModeProfile): boolean {
	return (
		typeof profile.economyWeight === "number" &&
		typeof profile.comfortWeight === "number" &&
		Number.isFinite(profile.economyWeight) &&
		Number.isFinite(profile.comfortWeight)
	);
}

export type { GlobalModeResolution };
