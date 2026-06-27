import { EVCC_MODE_MAP } from "../core/constants";
import { isEmptySentinel } from "../core/sentinel";
import type { IntentFieldStatus, WallboxChargeStrategy, WallboxDeadlineType } from "../core/types";
import type { WallboxDeadlineValue } from "../core/types";
import { parseOptionalSoc } from "../core/validation";

export interface NormalizeModeResult {
	strategy: WallboxChargeStrategy;
	status: IntentFieldStatus;
	raw: unknown;
}

export function normalizeEvccMode(raw: unknown): NormalizeModeResult {
	if (isEmptySentinel(raw)) {
		return { strategy: "unknown", status: "missing", raw };
	}
	const s = String(raw).trim().toLowerCase();
	if (!s) {
		return { strategy: "unknown", status: "missing", raw };
	}
	const mapped = EVCC_MODE_MAP[s];
	if (mapped) {
		return { strategy: mapped, status: "valid", raw };
	}
	return { strategy: "unknown", status: "valid", raw };
}

export function normalizeChargeStrategyFromString(raw: unknown): NormalizeModeResult {
	return normalizeEvccMode(raw);
}

export function normalizeTargetSoc(raw: unknown): { value: number | null; status: IntentFieldStatus; raw: unknown } {
	const parsed = parseOptionalSoc(raw);
	return { ...parsed, raw };
}

export interface NormalizeDeadlineResult {
	value: WallboxDeadlineValue | null;
	status: IntentFieldStatus;
	raw: unknown;
}

export function normalizeDeadline(
	raw: unknown,
	defaultTimezone: string,
	now: Date,
	deadlineType: WallboxDeadlineType = "departure",
): NormalizeDeadlineResult {
	if (isEmptySentinel(raw)) {
		return { value: null, status: "missing", raw };
	}

	let ms: number | null = null;

	if (typeof raw === "number" && Number.isFinite(raw)) {
		// Sekunden vs. Millisekunden heuristisch
		ms = raw > 1e12 ? raw : raw * 1000;
	} else {
		const s = String(raw).trim();
		if (!s) {
			return { value: null, status: "missing", raw };
		}
		const asNum = parseFloat(s);
		if (/^\d+(\.\d+)?$/.test(s) && Number.isFinite(asNum)) {
			ms = asNum > 1e12 ? asNum : asNum * 1000;
		} else {
			const parsed = Date.parse(s);
			if (Number.isFinite(parsed)) {
				ms = parsed;
			}
		}
	}

	if (ms === null || !Number.isFinite(ms)) {
		return { value: null, status: "invalid", raw };
	}

	const at = new Date(ms).toISOString();
	if (ms < now.getTime()) {
		return {
			value: { type: deadlineType, at, timezone: defaultTimezone },
			status: "expired",
			raw,
		};
	}

	return {
		value: { type: deadlineType, at, timezone: defaultTimezone },
		status: "valid",
		raw,
	};
}

export function immediateFromBool(raw: unknown): WallboxChargeStrategy | null {
	if (raw === null || raw === undefined || raw === "") {
		return null;
	}
	if (typeof raw === "boolean") {
		return raw ? "immediate" : null;
	}
	const s = String(raw).trim().toLowerCase();
	if (["1", "true", "on", "yes", "ja"].includes(s)) {
		return "immediate";
	}
	return null;
}
