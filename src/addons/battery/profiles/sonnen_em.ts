import { capability, emptyCapabilityMatrix } from "../core/capabilities";
import { isMappingConfigured, missingMappings } from "../mapping";
import type { BatteryMappingRole } from "../mapping";
import type { BatteryOperatingMode, CapabilityMatrix } from "../core/types";
import type { BatteryProfile, ProfileBuildInput, ProfileReadiness } from "./types";

const REQUIRED_READ: BatteryMappingRole[] = ["soc_pct", "power_w", "operating_mode_read"];
const REQUIRED_WRITE: BatteryMappingRole[] = ["set_operating_mode", "set_charge_power"];
const GRID_BALANCE_READ: BatteryMappingRole[] = ["consumption_w", "pv_ac_power_w", "soc_pct"];

function normalizeSonnenMode(raw: unknown, manualVal: number, selfVal: number): BatteryOperatingMode {
	if (raw === null || raw === undefined || raw === "") return "unknown";
	const n = typeof raw === "number" ? raw : parseInt(String(raw).trim(), 10);
	if (!Number.isFinite(n)) return "unknown";
	if (n === manualVal) return "manual";
	if (n === selfVal) return "self_consumption";
	return "unknown";
}

export const SONNEN_EM_PROFILE: BatteryProfile = {
	id: "sonnen_em",
	displayNameDe: "Sonnen – EM-Steuerung",
	displayNameEn: "Sonnen – EM control",
	supportsRead: true,
	supportsDryrun: true,
	supportsLive: true,
	requiredReadRoles: REQUIRED_READ,
	requiredWriteRoles: REQUIRED_WRITE,

	normalizeOperatingMode(raw, input): BatteryOperatingMode {
		return normalizeSonnenMode(
			raw,
			input.config.sonnenModeValues.manual,
			input.config.sonnenModeValues.selfConsumption,
		);
	},

	buildCapabilities(input: ProfileBuildInput): CapabilityMatrix {
		const m = emptyCapabilityMatrix();
		const { mapping, limits, config } = input;
		const limitsValid = limits.valid;

		m.read_soc = capability(true, isMappingConfigured(mapping, "soc_pct"), "mapping_missing");
		m.read_power = capability(true, isMappingConfigured(mapping, "power_w"), "mapping_missing");
		m.read_capacity = capability(true, isMappingConfigured(mapping, "capacity_kwh"), "mapping_missing");
		m.read_operating_mode = capability(
			true,
			isMappingConfigured(mapping, "operating_mode_read"),
			"mapping_missing",
		);
		m.read_online_status = capability(true, isMappingConfigured(mapping, "online"), "mapping_missing");

		const modeWrite = isMappingConfigured(mapping, "set_operating_mode");
		const chargeWrite = isMappingConfigured(mapping, "set_charge_power");

		m.set_operating_mode = capability(true, modeWrite && limitsValid, modeWrite ? "limits_invalid" : "mapping_missing");
		m.set_charge_power = capability(true, chargeWrite && limitsValid, chargeWrite ? "limits_invalid" : "mapping_missing");
		m.enable_grid_charge = capability(true, modeWrite && chargeWrite && limitsValid, "mapping_or_limits");
		m.hold_battery = capability(true, modeWrite && limitsValid, "mapping_or_limits");

		// Entladesteuerung ohne geprüfte technische Grundlage nicht aktivieren.
		m.set_discharge_power = capability(false, false, "discharge_unverified");

		m.verify_operating_mode = capability(true, isMappingConfigured(mapping, "operating_mode_read"), "mapping_missing");
		m.verify_charge_power = capability(true, isMappingConfigured(mapping, "power_w"), "mapping_missing");

		m.safe_restore = capability(true, modeWrite && limitsValid, "mapping_or_limits");

		const gbConfigured =
			config.gridBalance.enabled &&
			chargeWrite &&
			GRID_BALANCE_READ.every((r) => isMappingConfigured(mapping, r));
		m.control_grid_balance = capability(true, gbConfigured, "grid_balance_not_configured");

		const liveConfigured = modeWrite && chargeWrite && limitsValid;
		m.live_control = capability(true, liveConfigured, "mapping_or_limits");

		return m;
	},

	computeReadiness(input: ProfileBuildInput): ProfileReadiness {
		const missingRead = missingMappings(input.mapping, REQUIRED_READ);
		const missingWrite = missingMappings(input.mapping, REQUIRED_WRITE);
		const telemetryReady = missingRead.length === 0;
		const controlReady = missingWrite.length === 0 && input.limits.valid;
		const dryrunReady = telemetryReady;
		const liveReady = controlReady && telemetryReady && input.limits.valid;

		let reason = "ready";
		if (!telemetryReady) reason = "telemetry_mapping_missing";
		else if (missingWrite.length > 0) reason = "write_mapping_missing";
		else if (!input.limits.valid) reason = "limits_invalid";

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
