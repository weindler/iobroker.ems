export interface PvShapeConfig {
	enabled: boolean;
	/** z. B. "brightsky.0.hourly" — Adapter liest `${prefix}.NN.timestamp/.cloud_cover/.solar_estimate`. */
	brightskyHourlyPrefix: string;
	/** Optional: State-IDs mit installierter kWp-Leistung (z. B. zwei Dachflächen). */
	kwpState1: string;
	kwpState2: string;
}

function strField(config: Record<string, unknown>, key: string): string {
	const v = config[key];
	return typeof v === "string" ? v.trim() : "";
}

function boolField(config: Record<string, unknown>, key: string, defaultVal: boolean): boolean {
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

export function pvShapeConfigFromAdapter(config: unknown): PvShapeConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	return {
		enabled: boolField(c, "pv_shape_enabled", false),
		brightskyHourlyPrefix: strField(c, "pv_shape_brightsky_hourly_prefix"),
		kwpState1: strField(c, "pv_shape_kwp_state_1"),
		kwpState2: strField(c, "pv_shape_kwp_state_2"),
	};
}

/** Feature nur aktiv, wenn explizit aktiviert UND eine Stundenquelle konfiguriert ist. */
export function pvShapeConfigReady(cfg: PvShapeConfig): boolean {
	return cfg.enabled && cfg.brightskyHourlyPrefix.trim().length > 0;
}
