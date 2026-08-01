"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupVehicleMapEntry = void 0;
function norm(s) {
    if (s == null)
        return null;
    const t = String(s).trim();
    return t ? t : null;
}
/**
 * Match active EVCC vehicle name/title against mini-map `evcc_vehicle_id` (exact, case-sensitive).
 * Prefers vehicleName, then vehicleTitle. Skips disabled entries.
 */
function lookupVehicleMapEntry(entries, vehicleName, vehicleTitle = null) {
    const name = norm(vehicleName);
    const title = norm(vehicleTitle);
    if (!name && !title)
        return null;
    const enabled = entries.filter((e) => e.enabled);
    if (enabled.length === 0)
        return null;
    if (name) {
        const byName = enabled.find((e) => e.evccVehicleId === name);
        if (byName)
            return byName;
    }
    if (title) {
        const byTitle = enabled.find((e) => e.evccVehicleId === title);
        if (byTitle)
            return byTitle;
    }
    return null;
}
exports.lookupVehicleMapEntry = lookupVehicleMapEntry;
