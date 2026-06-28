"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SONNEN_EM_PROFILE = void 0;
const capabilities_1 = require("../core/capabilities");
const mapping_1 = require("../mapping");
const REQUIRED_READ = ["soc_pct", "power_w", "operating_mode_read"];
const REQUIRED_WRITE = ["set_operating_mode", "set_charge_power"];
const GRID_BALANCE_READ = ["consumption_w", "pv_ac_power_w", "soc_pct"];
function normalizeSonnenMode(raw, manualVal, selfVal) {
    if (raw === null || raw === undefined || raw === "")
        return "unknown";
    const n = typeof raw === "number" ? raw : parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(n))
        return "unknown";
    if (n === manualVal)
        return "manual";
    if (n === selfVal)
        return "self_consumption";
    return "unknown";
}
exports.SONNEN_EM_PROFILE = {
    id: "sonnen_em",
    displayNameDe: "Sonnen – EM-Steuerung",
    displayNameEn: "Sonnen – EM control",
    supportsRead: true,
    supportsDryrun: true,
    supportsLive: true,
    requiredReadRoles: REQUIRED_READ,
    requiredWriteRoles: REQUIRED_WRITE,
    normalizeOperatingMode(raw, input) {
        return normalizeSonnenMode(raw, input.config.sonnenModeValues.manual, input.config.sonnenModeValues.selfConsumption);
    },
    buildCapabilities(input) {
        const m = (0, capabilities_1.emptyCapabilityMatrix)();
        const { mapping, limits, config } = input;
        const limitsValid = limits.valid;
        m.read_soc = (0, capabilities_1.capability)(true, (0, mapping_1.isMappingConfigured)(mapping, "soc_pct"), "mapping_missing");
        m.read_power = (0, capabilities_1.capability)(true, (0, mapping_1.isMappingConfigured)(mapping, "power_w"), "mapping_missing");
        m.read_capacity = (0, capabilities_1.capability)(true, (0, mapping_1.isMappingConfigured)(mapping, "capacity_kwh"), "mapping_missing");
        m.read_operating_mode = (0, capabilities_1.capability)(true, (0, mapping_1.isMappingConfigured)(mapping, "operating_mode_read"), "mapping_missing");
        m.read_online_status = (0, capabilities_1.capability)(true, (0, mapping_1.isMappingConfigured)(mapping, "online"), "mapping_missing");
        const modeWrite = (0, mapping_1.isMappingConfigured)(mapping, "set_operating_mode");
        const chargeWrite = (0, mapping_1.isMappingConfigured)(mapping, "set_charge_power");
        m.set_operating_mode = (0, capabilities_1.capability)(true, modeWrite && limitsValid, modeWrite ? "limits_invalid" : "mapping_missing");
        m.set_charge_power = (0, capabilities_1.capability)(true, chargeWrite && limitsValid, chargeWrite ? "limits_invalid" : "mapping_missing");
        m.enable_grid_charge = (0, capabilities_1.capability)(true, modeWrite && chargeWrite && limitsValid, "mapping_or_limits");
        m.hold_battery = (0, capabilities_1.capability)(true, modeWrite && limitsValid, "mapping_or_limits");
        // Entladesteuerung ohne geprüfte technische Grundlage nicht aktivieren.
        m.set_discharge_power = (0, capabilities_1.capability)(false, false, "discharge_unverified");
        m.verify_operating_mode = (0, capabilities_1.capability)(true, (0, mapping_1.isMappingConfigured)(mapping, "operating_mode_read"), "mapping_missing");
        m.verify_charge_power = (0, capabilities_1.capability)(true, (0, mapping_1.isMappingConfigured)(mapping, "power_w"), "mapping_missing");
        m.safe_restore = (0, capabilities_1.capability)(true, modeWrite && limitsValid, "mapping_or_limits");
        const gbConfigured = config.gridBalance.enabled &&
            chargeWrite &&
            GRID_BALANCE_READ.every((r) => (0, mapping_1.isMappingConfigured)(mapping, r));
        m.control_grid_balance = (0, capabilities_1.capability)(true, gbConfigured, "grid_balance_not_configured");
        const liveConfigured = modeWrite && chargeWrite && limitsValid;
        m.live_control = (0, capabilities_1.capability)(true, liveConfigured, "mapping_or_limits");
        return m;
    },
    computeReadiness(input) {
        const missingRead = (0, mapping_1.missingMappings)(input.mapping, REQUIRED_READ);
        const missingWrite = (0, mapping_1.missingMappings)(input.mapping, REQUIRED_WRITE);
        const telemetryReady = missingRead.length === 0;
        const controlReady = missingWrite.length === 0 && input.limits.valid;
        const dryrunReady = telemetryReady;
        const liveReady = controlReady && telemetryReady && input.limits.valid;
        let reason = "ready";
        if (!telemetryReady)
            reason = "telemetry_mapping_missing";
        else if (missingWrite.length > 0)
            reason = "write_mapping_missing";
        else if (!input.limits.valid)
            reason = "limits_invalid";
        return {
            telemetryReady,
            controlReady,
            dryrunReady,
            liveReady,
            reason,
            missingRequired: [...missingRead, ...missingWrite],
        };
    },
};
