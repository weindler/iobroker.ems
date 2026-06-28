import type { BatteryHardwareLimits } from "./types";

function num(raw: unknown): number | null {
	if (raw === null || raw === undefined || raw === "" || typeof raw === "boolean") {
		return null;
	}
	const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
	return Number.isFinite(n) ? n : null;
}

export interface HardwareLimitsConfig {
	bat_hw_max_charge_w?: unknown;
	bat_hw_max_discharge_w?: unknown;
	bat_hw_min_soc_pct?: unknown;
	bat_hw_max_soc_pct?: unknown;
}

/**
 * Technische Hardwaregrenzen aus der Adapter-Konfiguration.
 * Plausibilität: max_charge_w > 0, max_discharge_w >= 0,
 * 0 <= min_soc_pct < max_soc_pct <= 100.
 */
export function hardwareLimitsFromConfig(config: unknown): BatteryHardwareLimits {
	const c = (config && typeof config === "object" ? config : {}) as HardwareLimitsConfig;
	const maxChargeW = num(c.bat_hw_max_charge_w);
	const maxDischargeW = num(c.bat_hw_max_discharge_w);
	const minSocPct = num(c.bat_hw_min_soc_pct);
	const maxSocPct = num(c.bat_hw_max_soc_pct);

	const issues: string[] = [];
	if (maxChargeW === null || !(maxChargeW > 0)) {
		issues.push("max_charge_w_invalid");
	}
	if (maxDischargeW !== null && maxDischargeW < 0) {
		issues.push("max_discharge_w_invalid");
	}
	if (minSocPct === null || maxSocPct === null) {
		issues.push("soc_limits_missing");
	} else if (!(minSocPct >= 0 && minSocPct < maxSocPct && maxSocPct <= 100)) {
		issues.push("soc_limits_invalid");
	}

	return {
		maxChargeW,
		maxDischargeW,
		minSocPct,
		maxSocPct,
		valid: issues.length === 0,
		issues,
	};
}

/** Entladefähigkeit nur, wenn explizit eine positive Entladegrenze konfiguriert ist. */
export function hasDischargeCapability(limits: BatteryHardwareLimits): boolean {
	return limits.maxDischargeW !== null && limits.maxDischargeW > 0;
}
