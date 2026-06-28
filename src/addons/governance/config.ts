import { governedAddonByRuntimeId, governedAddonEntry, isGovernedAddonId } from "./registry";
import type { AddonGovernance, GovernedAddonId } from "./types";

function configRecord(config: unknown): Record<string, unknown> {
	return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

export function boolField(config: Record<string, unknown>, key: string, defaultVal: boolean): boolean {
	const v = config[key];
	if (typeof v === "boolean") return v;
	if (typeof v === "number") return v !== 0;
	if (typeof v === "string") {
		const s = v.trim().toLowerCase();
		if (["1", "true", "on", "yes", "ja"].includes(s)) return true;
		if (["0", "false", "off", "no", "nein"].includes(s)) return false;
	}
	return defaultVal;
}

/** Default true — preserves prior runtime default (addons.*.enabled def true). */
const DEFAULT_ADDON_ENABLED = true;
const DEFAULT_AI_ALLOWED = false;

export function isAddonEnabled(config: unknown, addonId: GovernedAddonId): boolean {
	const entry = governedAddonEntry(addonId);
	return boolField(configRecord(config), entry.enabledConfigKey, DEFAULT_ADDON_ENABLED);
}

export function isAddonAiOptimizationAllowed(config: unknown, addonId: GovernedAddonId): boolean {
	const entry = governedAddonEntry(addonId);
	return boolField(configRecord(config), entry.aiAllowedConfigKey, DEFAULT_AI_ALLOWED);
}

export function getAddonGovernance(config: unknown, addonId: GovernedAddonId): AddonGovernance {
	return {
		enabled: isAddonEnabled(config, addonId),
		aiOptimizationAllowed: isAddonAiOptimizationAllowed(config, addonId),
	};
}

export function resolveGovernedAddonId(addonOrRuntimeId: string): GovernedAddonId | null {
	if (isGovernedAddonId(addonOrRuntimeId)) {
		return addonOrRuntimeId;
	}
	const entry = governedAddonByRuntimeId(addonOrRuntimeId);
	return entry?.id ?? null;
}
