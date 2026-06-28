import type { BatteryProfileId } from "../core/types";
import { GENERIC_READONLY_PROFILE } from "./generic_readonly";
import { SONNEN_EM_PROFILE } from "./sonnen_em";
import type { BatteryProfile } from "./types";

export const BATTERY_PROFILES: readonly BatteryProfile[] = [
	GENERIC_READONLY_PROFILE,
	SONNEN_EM_PROFILE,
];

export function getBatteryProfile(id: BatteryProfileId): BatteryProfile {
	const found = BATTERY_PROFILES.find((p) => p.id === id);
	return found ?? GENERIC_READONLY_PROFILE;
}

export function batteryProfileIds(): BatteryProfileId[] {
	return BATTERY_PROFILES.map((p) => p.id);
}
