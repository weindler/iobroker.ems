"use strict";
/**
 * Slim EVCC vehicle mini-map (v0.1.227+).
 * Optional capacity / max-AC planning hints keyed by exact EVCC vehicle name/id.
 * Empty map is valid — EVCC-first wallbox planning works without entries.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.slimEntryFromLegacyProfileRow = exports.vehicleMapEntryToExportRow = exports.wallboxVehicleMapFromAdapter = exports.WB_VEHICLE_MAP = void 0;
exports.WB_VEHICLE_MAP = "wb_vehicle_map";
function strField(row, key) {
    const v = row[key];
    return typeof v === "string" ? v.trim() : v != null && v !== "" ? String(v).trim() : "";
}
function optionalPositiveNumber(raw) {
    if (raw === null || raw === undefined || raw === "")
        return null;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 0)
        return null;
    return n;
}
function parseEnabled(raw) {
    if (raw === false || raw === 0 || raw === "0" || raw === "false")
        return false;
    if (raw === true || raw === 1 || raw === "1" || raw === "true")
        return true;
    // Default enabled when checkbox omitted (new row with only EVCC id).
    return raw === undefined || raw === null || raw === "" ? true : Boolean(raw);
}
function entryFromRow(row) {
    const evccVehicleId = strField(row, "evcc_vehicle_id");
    if (!evccVehicleId)
        return null;
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
function wallboxVehicleMapFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const raw = c[exports.WB_VEHICLE_MAP];
    if (!Array.isArray(raw))
        return { entries: [] };
    const seen = new Set();
    const entries = [];
    for (const item of raw) {
        if (!item || typeof item !== "object")
            continue;
        const entry = entryFromRow(item);
        if (!entry)
            continue;
        const key = entry.evccVehicleId.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        entries.push(entry);
    }
    return { entries };
}
exports.wallboxVehicleMapFromAdapter = wallboxVehicleMapFromAdapter;
/** Slim export row for backup (only allowlisted keys). */
function vehicleMapEntryToExportRow(entry) {
    return {
        evcc_vehicle_id: entry.evccVehicleId,
        display_name: entry.displayName ?? "",
        enabled: entry.enabled,
        battery_capacity_net_kwh: entry.batteryCapacityNetKwh,
        max_ac_charge_power_w: entry.maxAcChargePowerW,
    };
}
exports.vehicleMapEntryToExportRow = vehicleMapEntryToExportRow;
/**
 * Migrate a legacy fat `wb_vehicle_profiles` row into a slim map entry.
 * Requires a non-empty EVCC id or name; otherwise returns null.
 */
function slimEntryFromLegacyProfileRow(row) {
    if (!row || typeof row !== "object" || Array.isArray(row))
        return null;
    const r = row;
    const evccId = strField(r, "evcc_vehicle_id") || strField(r, "evcc_vehicle_name");
    if (!evccId)
        return null;
    return entryFromRow({
        evcc_vehicle_id: evccId,
        display_name: r.display_name,
        enabled: r.enabled,
        battery_capacity_net_kwh: r.battery_capacity_net_kwh,
        max_ac_charge_power_w: r.max_ac_charge_power_w,
    });
}
exports.slimEntryFromLegacyProfileRow = slimEntryFromLegacyProfileRow;
