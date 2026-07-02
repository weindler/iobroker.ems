/** EVCC telemetry value normalization — missing stays missing, never invent 0/false. */

import { isEmptySentinel } from "../../intent/core/sentinel";
import { parseOptionalSoc } from "../../intent/core/validation";

export type TelemetryFieldStatus = "valid" | "missing" | "invalid";

export interface TelemetryField<T> {
	value: T | null;
	status: TelemetryFieldStatus;
	raw: unknown;
}

export function missingField<T>(): TelemetryField<T> {
	return { value: null, status: "missing", raw: null };
}

export function normalizeOptionalBool(raw: unknown): TelemetryField<boolean> {
	if (isEmptySentinel(raw)) return missingField();
	if (typeof raw === "boolean") return { value: raw, status: "valid", raw };
	if (typeof raw === "number" && Number.isFinite(raw)) {
		if (raw === 0) return { value: false, status: "valid", raw };
		if (raw === 1) return { value: true, status: "valid", raw };
		return { value: null, status: "invalid", raw };
	}
	const s = String(raw).trim().toLowerCase();
	if (!s) return missingField();
	if (["1", "true", "on", "yes", "ja"].includes(s)) return { value: true, status: "valid", raw };
	if (["0", "false", "off", "no", "nein"].includes(s)) return { value: false, status: "valid", raw };
	return { value: null, status: "invalid", raw };
}

export function normalizeOptionalNumber(raw: unknown): TelemetryField<number> {
	if (isEmptySentinel(raw)) return missingField();
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return { value: raw, status: "valid", raw };
	}
	const s = String(raw).trim();
	if (!s) return missingField();
	const n = parseFloat(s.replace(",", "."));
	if (!Number.isFinite(n)) return { value: null, status: "invalid", raw };
	return { value: n, status: "valid", raw };
}

export function normalizeOptionalSoc(raw: unknown): TelemetryField<number> {
	if (isEmptySentinel(raw)) return missingField();
	const parsed = parseOptionalSoc(raw);
	return { value: parsed.value, status: parsed.status === "valid" ? "valid" : parsed.status === "missing" ? "missing" : "invalid", raw };
}

export function normalizeOptionalPhases(raw: unknown): TelemetryField<number> {
	const n = normalizeOptionalNumber(raw);
	if (n.status !== "valid" || n.value === null) return n;
	if (n.value < 0 || n.value > 3) return { value: null, status: "invalid", raw };
	return n;
}

const EVCC_BATTERY_MODES = new Set(["normal", "hold", "charge", "holdcharge", "unknown"]);

export function normalizeOptionalBatteryMode(raw: unknown): TelemetryField<string> {
	if (isEmptySentinel(raw)) return missingField();
	if (typeof raw === "number" && Number.isFinite(raw)) {
		const map: Record<number, string> = { 0: "unknown", 1: "normal", 2: "hold", 3: "charge", 4: "holdcharge" };
		const mode = map[raw];
		return mode ? { value: mode, status: "valid", raw } : { value: null, status: "invalid", raw };
	}
	const s = String(raw).trim().toLowerCase();
	if (!s) return missingField();
	if (EVCC_BATTERY_MODES.has(s)) return { value: s, status: "valid", raw };
	return { value: null, status: "invalid", raw };
}
