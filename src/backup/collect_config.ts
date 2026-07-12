import { executionModesFromConfig } from "../execution_mode";
import { isSecretKey } from "./schema";
import type { AdapterConfigExport } from "./types";

/** Erlaubte Native-Config-Präfixe (Allowlist). */
const ALLOWED_PREFIXES = [
	"global_",
	"wallbox_",
	"wb_",
	"bat_",
	"battery_",
	"ih_",
	"immersion_",
	"ac_",
	"climate_",
	"ems_",
	"ems_light_",
	"intent_",
	"planner_",
	"policy_",
	"learning_",
	"operator_",
	"pv_",
	"price_",
	"weather_",
	"house_",
	"thermal_",
	"tariff_",
	"dt_",
];

const ALLOWED_EXACT = new Set(["mapping", "wb_vehicle_profiles"]);

/** Explizite Fahrzeugprofil-Felder (kein „alle Felder außer Secrets“). */
export const VEHICLE_PROFILE_ALLOWED_KEYS = new Set([
	"vehicle_id",
	"display_name",
	"enabled",
	"is_guest",
	"source",
	"evcc_vehicle_id",
	"evcc_vehicle_name",
	"battery_capacity_net_kwh",
	"max_ac_charge_power_w",
	"supported_phases",
	"preferred_phases",
	"min_current_a",
	"max_current_a",
	"default_target_soc_pct",
	"minimum_departure_soc_pct",
	"maximum_soc_pct",
	"charge_efficiency_pct",
	"reference_range_at_100_pct_km",
	"soc_fallback_max_age_min",
	"soc_state",
	"range_state",
	"connected_state",
	"charging_state",
	"session_energy_state",
	"created_at",
	"updated_at",
]);

const MAPPING_ADDON_KEYS = new Set(["wallbox", "battery", "immersion_heater", "air_conditioning", "climate"]);

const MAPPING_SUBKEY_RE = /(_target|_enabled|_state|_mode)$/;

export function isAllowedConfigKey(key: string): boolean {
	if (isSecretKey(key)) return false;
	if (ALLOWED_EXACT.has(key)) return true;
	return ALLOWED_PREFIXES.some((p) => key.startsWith(p));
}

export function filterAllowlistedConfig(config: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(config)) {
		if (!isAllowedConfigKey(key)) continue;
		if (val !== undefined) {
			out[key] = val;
		}
	}
	return out;
}

function filterMappingObject(mapping: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [addonKey, addonVal] of Object.entries(mapping)) {
		if (!MAPPING_ADDON_KEYS.has(addonKey)) continue;
		if (addonVal === null || typeof addonVal === "string" || typeof addonVal === "number" || typeof addonVal === "boolean") {
			if (!isSecretKey(addonKey)) out[addonKey] = addonVal;
			continue;
		}
		if (!addonVal || typeof addonVal !== "object" || Array.isArray(addonVal)) continue;
		const sub: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(addonVal as Record<string, unknown>)) {
			if (isSecretKey(k)) continue;
			if (!MAPPING_SUBKEY_RE.test(k) && !isAllowedConfigKey(k)) continue;
			if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
				sub[k] = v;
			}
		}
		if (Object.keys(sub).length > 0) out[addonKey] = sub;
	}
	return out;
}

export function collectAdapterConfigExport(config: unknown): AdapterConfigExport {
	const raw = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const modes = executionModesFromConfig(raw);
	return {
		allowed_native: filterAllowlistedConfig(raw),
		configured_modes_at_export: {
			global: modes.global,
			wallbox: modes.wallbox,
			battery: modes.battery,
			immersion_heater: modes.immersion_heater,
			air_conditioning: modes.air_conditioning,
		},
		restore_policy: {
			apply_as: "dryrun",
		},
	};
}

export function collectMappingsExport(config: unknown): Record<string, unknown> {
	const raw = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const mapping = raw.mapping && typeof raw.mapping === "object" ? (raw.mapping as Record<string, unknown>) : {};
	const out: Record<string, unknown> = {};

	const flatKeys = Object.keys(raw).filter(
		(k) =>
			(k.endsWith("_target") || k.endsWith("_enabled") || k.endsWith("_state")) &&
			isAllowedConfigKey(k) &&
			!isSecretKey(k),
	);
	for (const k of flatKeys) {
		out[k] = raw[k];
	}
	const filteredMapping = filterMappingObject(mapping);
	if (Object.keys(filteredMapping).length > 0) {
		out.mapping = filteredMapping;
	}
	return out;
}

export function filterVehicleProfileRow(row: unknown): Record<string, unknown> | unknown {
	if (!row || typeof row !== "object" || Array.isArray(row)) return row;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
		if (!VEHICLE_PROFILE_ALLOWED_KEYS.has(k) || isSecretKey(k)) continue;
		if (v !== undefined && v !== null && typeof v === "object") continue;
		out[k] = v;
	}
	return out;
}

export function collectVehicleProfilesExport(config: unknown): { profiles: unknown[] } {
	const raw = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const profiles = Array.isArray(raw.wb_vehicle_profiles) ? raw.wb_vehicle_profiles : [];
	return { profiles: profiles.map((row) => filterVehicleProfileRow(row)) };
}

export function collectPoliciesExport(config: unknown): Record<string, unknown> {
	const raw = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(raw)) {
		if (k.startsWith("policy_") || k.startsWith("global_mode_") || k.startsWith("planner_")) {
			if (!isSecretKey(k)) out[k] = v;
		}
	}
	return out;
}
