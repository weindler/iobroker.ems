"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERIC_READONLY_PROFILE = void 0;
const capabilities_1 = require("../core/capabilities");
const mapping_1 = require("../mapping");
const REQUIRED_READ = ["soc_pct"];
function normalizeGenericMode(raw) {
    if (raw === null || raw === undefined || raw === "")
        return "unknown";
    const s = String(raw).trim().toLowerCase();
    const map = {
        self_consumption: "self_consumption",
        manual: "manual",
        charging: "charging",
        grid_charging: "grid_charging",
        discharging: "discharging",
        hold: "hold",
        idle: "idle",
        fault: "fault",
    };
    return map[s] ?? "unknown";
}
exports.GENERIC_READONLY_PROFILE = {
    id: "generic_readonly",
    displayNameDe: "Generisch – nur lesen",
    displayNameEn: "Generic – read only",
    supportsRead: true,
    supportsDryrun: false,
    supportsLive: false,
    requiredReadRoles: REQUIRED_READ,
    requiredWriteRoles: [],
    normalizeOperatingMode(raw) {
        return normalizeGenericMode(raw);
    },
    buildCapabilities(input) {
        const m = (0, capabilities_1.emptyCapabilityMatrix)();
        const { mapping } = input;
        m.read_soc = (0, capabilities_1.capability)(true, (0, mapping_1.isMappingConfigured)(mapping, "soc_pct"), "mapping_missing");
        m.read_power = (0, capabilities_1.capability)(true, (0, mapping_1.isMappingConfigured)(mapping, "power_w"), "mapping_missing");
        m.read_capacity = (0, capabilities_1.capability)(true, (0, mapping_1.isMappingConfigured)(mapping, "capacity_kwh"), "mapping_missing");
        m.read_operating_mode = (0, capabilities_1.capability)(true, (0, mapping_1.isMappingConfigured)(mapping, "operating_mode_read"), "mapping_missing");
        m.read_online_status = (0, capabilities_1.capability)(true, (0, mapping_1.isMappingConfigured)(mapping, "online"), "mapping_missing");
        // All set_*, control and live capabilities remain false.
        m.set_operating_mode.reason = "generic_readonly_profile";
        m.set_charge_power.reason = "generic_readonly_profile";
        m.set_discharge_power.reason = "generic_readonly_profile";
        m.enable_grid_charge.reason = "generic_readonly_profile";
        m.live_control.reason = "generic_readonly_profile";
        m.safe_restore.reason = "generic_readonly_profile";
        return m;
    },
    computeReadiness(input) {
        const missing = (0, mapping_1.missingMappings)(input.mapping, REQUIRED_READ);
        const telemetryReady = missing.length === 0;
        return {
            telemetryReady,
            controlReady: false,
            dryrunReady: false,
            liveReady: false,
            reason: "generic_readonly_profile",
            missingRequired: missing,
        };
    },
};
