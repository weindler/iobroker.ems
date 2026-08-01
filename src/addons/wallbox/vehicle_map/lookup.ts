import type { WallboxVehicleMapEntry } from "./config";

function norm(s: string | null | undefined): string | null {
	if (s == null) return null;
	const t = String(s).trim();
	return t ? t : null;
}

/**
 * Match active EVCC vehicle name/title against mini-map `evcc_vehicle_id` (exact, case-sensitive).
 * Prefers vehicleName, then vehicleTitle. Skips disabled entries.
 */
export function lookupVehicleMapEntry(
	entries: readonly WallboxVehicleMapEntry[],
	vehicleName: string | null | undefined,
	vehicleTitle: string | null | undefined = null,
): WallboxVehicleMapEntry | null {
	const name = norm(vehicleName);
	const title = norm(vehicleTitle);
	if (!name && !title) return null;

	const enabled = entries.filter((e) => e.enabled);
	if (enabled.length === 0) return null;

	if (name) {
		const byName = enabled.find((e) => e.evccVehicleId === name);
		if (byName) return byName;
	}
	if (title) {
		const byTitle = enabled.find((e) => e.evccVehicleId === title);
		if (byTitle) return byTitle;
	}
	return null;
}
