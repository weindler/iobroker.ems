import { ADMIN_CONFIG_KEY_DEFAULT, DEFAULT_GLOBAL_MODE, type GlobalMode } from "./constants";
import { GLOBAL_MODES } from "./constants";

function strField(config: Record<string, unknown>, key: string): string {
	const v = config[key];
	return typeof v === "string" ? v.trim().toLowerCase() : "";
}

export function isGlobalMode(raw: string): raw is GlobalMode {
	return (GLOBAL_MODES as readonly string[]).includes(raw);
}

export function globalModeDefaultFromConfig(config: unknown): GlobalMode {
	if (!config || typeof config !== "object") {
		return DEFAULT_GLOBAL_MODE;
	}
	const raw = strField(config as Record<string, unknown>, ADMIN_CONFIG_KEY_DEFAULT);
	if (raw && isGlobalMode(raw)) {
		return raw;
	}
	return DEFAULT_GLOBAL_MODE;
}
