/** Time and numeric canonization for dual-run semantic comparison. */

import {
	TAKEOVER_TOLERANCE_ENERGY_KWH,
	TAKEOVER_TOLERANCE_PERCENT,
	TAKEOVER_TOLERANCE_POWER_W,
	TAKEOVER_TOLERANCE_PRICE_CT,
} from "./constants";

/** Strip sub-second noise; keep UTC ISO-8601 to the second. */
export function canonicalizeUtcIso(value: string): string {
	const ms = Date.parse(value);
	if (!Number.isFinite(ms)) {
		return value;
	}
	return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function roundTo(value: number, decimals: number): number {
	const f = 10 ** decimals;
	return Math.round(value * f) / f;
}

/** Power: whole watts. */
export function canonicalizePowerW(value: number | null | undefined): number | null {
	if (value === null || value === undefined || !Number.isFinite(value)) return null;
	return Math.round(value);
}

/** Energy: 6 decimal kWh (≈1 Wh resolution). */
export function canonicalizeEnergyKwh(value: number | null | undefined): number | null {
	if (value === null || value === undefined || !Number.isFinite(value)) return null;
	return roundTo(value, 6);
}

/** Price: 4 decimal ct/kWh. */
export function canonicalizePriceCt(value: number | null | undefined): number | null {
	if (value === null || value === undefined || !Number.isFinite(value)) return null;
	return roundTo(value, 4);
}

/** Percent: 2 decimal places. */
export function canonicalizePercent(value: number | null | undefined): number | null {
	if (value === null || value === undefined || !Number.isFinite(value)) return null;
	return roundTo(value, 2);
}

export type NumericDomain = "power_w" | "energy_kwh" | "price_ct" | "percent";

export function numbersSemanticallyEqual(
	a: number | null,
	b: number | null,
	domain: NumericDomain,
): boolean {
	if (a === null && b === null) return true;
	if (a === null || b === null) return false;
	const tol =
		domain === "power_w"
			? TAKEOVER_TOLERANCE_POWER_W
			: domain === "energy_kwh"
				? TAKEOVER_TOLERANCE_ENERGY_KWH
				: domain === "price_ct"
					? TAKEOVER_TOLERANCE_PRICE_CT
					: TAKEOVER_TOLERANCE_PERCENT;
	return Math.abs(a - b) <= tol;
}

export function utcDayKey(iso: string): string {
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return iso.slice(0, 10);
	return new Date(ms).toISOString().slice(0, 10);
}

export function slotDurationMinutes(startIso: string, endIso: string): number {
	const a = Date.parse(startIso);
	const b = Date.parse(endIso);
	if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
	return Math.round((b - a) / 60_000);
}
