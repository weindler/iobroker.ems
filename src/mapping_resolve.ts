/**
 * Mapping-Ziele aus der Adapterkonfiguration (jsonConfig) — keine ioBroker-Spiegelstates.
 */

import { acMappingFromConfig } from "./addons/air_conditioning/mapping_config";
import { batteryMappingNativeFromConfig } from "./addons/battery/mapping";
import { dynamicTariffMappingFromConfig } from "./addons/dynamic_tariff/mapping_config";
import { immersionHeaterMappingFromConfig } from "./addons/immersion_heater/mapping_config";
import { wallboxMappingFromConfig, type NativeMappingEntry } from "./mapping_config";

export type ResolvedNativeMapping = {
	enabled: boolean;
	targetState: string;
	allowedValues: string | null;
};

function asConfig(config: unknown): Record<string, unknown> {
	return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

export function mappingTableFromConfig(config: unknown, addonId: string): Record<string, NativeMappingEntry> {
	const cfg = asConfig(config);
	switch (addonId) {
		case "wallbox":
			return wallboxMappingFromConfig(cfg);
		case "battery":
			return batteryMappingNativeFromConfig(cfg);
		case "immersion_heater":
			return immersionHeaterMappingFromConfig(cfg);
		case "air_conditioning":
			return acMappingFromConfig(cfg);
		case "dynamic_tariff":
			return dynamicTariffMappingFromConfig(cfg);
		default:
			return {};
	}
}

export function resolveMappingTargetFromConfig(
	config: unknown,
	addonId: string,
	role: string,
): ResolvedNativeMapping | null {
	const entry = mappingTableFromConfig(config, addonId)[role];
	if (!entry) {
		return null;
	}
	const targetState = typeof entry.target_state === "string" ? entry.target_state.trim() : "";
	if (!targetState) {
		return null;
	}
	const allowed =
		typeof entry.allowed_values === "string" && entry.allowed_values.trim() ? entry.allowed_values.trim() : null;
	return {
		enabled: entry.enabled !== false,
		targetState,
		allowedValues: allowed,
	};
}

export function hostAdapterConfig(host: { config?: unknown }): unknown {
	return host.config;
}
