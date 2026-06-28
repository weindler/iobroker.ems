import { capability, emptyCapabilityMatrix } from "../core/capabilities";
import { isMappingConfigured, missingMappings } from "../mapping";
import type { BatteryMappingRole } from "../mapping";
import type { BatteryOperatingMode, CapabilityMatrix } from "../core/types";
import type { BatteryProfile, ProfileBuildInput, ProfileReadiness } from "./types";

const REQUIRED_READ: BatteryMappingRole[] = ["soc_pct"];

function normalizeGenericMode(raw: unknown): BatteryOperatingMode {
	if (raw === null || raw === undefined || raw === "") return "unknown";
	const s = String(raw).trim().toLowerCase();
	const map: Record<string, BatteryOperatingMode> = {
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

export const GENERIC_READONLY_PROFILE: BatteryProfile = {
	id: "generic_readonly",
	displayNameDe: "Generisch – nur lesen",
	displayNameEn: "Generic – read only",
	supportsRead: true,
	supportsDryrun: false,
	supportsLive: false,
	requiredReadRoles: REQUIRED_READ,
	requiredWriteRoles: [],

	normalizeOperatingMode(raw): BatteryOperatingMode {
		return normalizeGenericMode(raw);
	},

	buildCapabilities(input: ProfileBuildInput): CapabilityMatrix {
		const m = emptyCapabilityMatrix();
		const { mapping } = input;
		m.read_soc = capability(true, isMappingConfigured(mapping, "soc_pct"), "mapping_missing");
		m.read_power = capability(true, isMappingConfigured(mapping, "power_w"), "mapping_missing");
		m.read_capacity = capability(true, isMappingConfigured(mapping, "capacity_kwh"), "mapping_missing");
		m.read_operating_mode = capability(
			true,
			isMappingConfigured(mapping, "operating_mode_read"),
			"mapping_missing",
		);
		m.read_online_status = capability(true, isMappingConfigured(mapping, "online"), "mapping_missing");
		// All set_*, control and live capabilities remain false.
		m.set_operating_mode.reason = "generic_readonly_profile";
		m.set_charge_power.reason = "generic_readonly_profile";
		m.set_discharge_power.reason = "generic_readonly_profile";
		m.enable_grid_charge.reason = "generic_readonly_profile";
		m.live_control.reason = "generic_readonly_profile";
		m.safe_restore.reason = "generic_readonly_profile";
		return m;
	},

	computeReadiness(input: ProfileBuildInput): ProfileReadiness {
		const missing = missingMappings(input.mapping, REQUIRED_READ);
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
