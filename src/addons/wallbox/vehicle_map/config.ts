/**
 * Slim EVCC vehicle mini-map (v0.1.227+).
 * Optional capacity / max-AC planning hints keyed by exact EVCC vehicle name/id.
 * Empty map is valid — EVCC-first wallbox planning works without entries.
 */

export const WB_VEHICLE_MAP = "wb_vehicle_map";

export interface WallboxVehicleMapEntry {
	evccVehicleId: string;
	displayName: string | null;
	enabled: boolean;
	batteryCapacityNetKwh: number | null;
	maxAcChargePowerW: number | null;
}

export interface WallboxVehicleMapConfig {
	entries: WallboxVehicleMapEntry[];
}

function strField(row: Record<string, unknown>, key: string): string {
	const v = row[key];
	return typeof v === "string" ? v.trim() : v != null && v !== "" ? String(v).trim() : "";
}

function optionalPositiveNumber(raw: unknown): number | null {
	if (raw === null || raw === undefined || raw === "") return null;
	const n = typeof raw === "number" ? raw : Number(raw);
	if (!Number.isFinite(n) || n <= 0) return null;
	return n;
}

function parseEnabled(raw: unknown): boolean {
	if (raw === false || raw === 0 || raw === "0" || raw === "false") return false;
	if (raw === true || raw === 1 || raw === "1" || raw === "true") return true;
	// Default enabled when checkbox omitted (new row with only EVCC id).
	return raw === undefined || raw === null || raw === "" ? true : Boolean(raw);
}

function entryFromRow(row: Record<string, unknown>): WallboxVehicleMapEntry | null {
	const evccVehicleId = strField(row, "evcc_vehicle_id");
	if (!evccVehicleId) return null;
	const displayRaw = strField(row, "display_name");
	return {
		evccVehicleId,
		displayName: displayRaw || null,
		enabled: parseEnabled(row.enabled),
		batteryCapacityNetKwh: optionalPositiveNumber(row.battery_capacity_net_kwh),
		maxAcChargePowerW: optionalPositiveNumber(row.max_ac_charge_power_w),
	};
}

/**
 * Parse admin `wb_vehicle_map` table rows.
 * Duplicate EVCC ids: first enabled wins; later duplicates ignored.
 */
export function wallboxVehicleMapFromAdapter(config: unknown): WallboxVehicleMapConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const raw = c[WB_VEHICLE_MAP];
	if (!Array.isArray(raw)) return { entries: [] };

	const seen = new Set<string>();
	const entries: WallboxVehicleMapEntry[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const entry = entryFromRow(item as Record<string, unknown>);
		if (!entry) continue;
		const key = entry.evccVehicleId.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		entries.push(entry);
	}
	return { entries };
}

/** Slim export row for backup (only allowlisted keys). */
export function vehicleMapEntryToExportRow(entry: WallboxVehicleMapEntry): Record<string, unknown> {
	return {
		evcc_vehicle_id: entry.evccVehicleId,
		display_name: entry.displayName ?? "",
		enabled: entry.enabled,
		battery_capacity_net_kwh: entry.batteryCapacityNetKwh,
		max_ac_charge_power_w: entry.maxAcChargePowerW,
	};
}

/**
 * Migrate a legacy fat `wb_vehicle_profiles` row into a slim map entry.
 * Requires a non-empty EVCC id or name; otherwise returns null.
 */
export function slimEntryFromLegacyProfileRow(row: unknown): WallboxVehicleMapEntry | null {
	if (!row || typeof row !== "object" || Array.isArray(row)) return null;
	const r = row as Record<string, unknown>;
	const evccId = strField(r, "evcc_vehicle_id") || strField(r, "evcc_vehicle_name");
	if (!evccId) return null;
	return entryFromRow({
		evcc_vehicle_id: evccId,
		display_name: r.display_name,
		enabled: r.enabled,
		battery_capacity_net_kwh: r.battery_capacity_net_kwh,
		max_ac_charge_power_w: r.max_ac_charge_power_w,
	});
}
