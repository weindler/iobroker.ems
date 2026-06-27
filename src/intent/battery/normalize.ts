import type { IntentFieldStatus } from "../core/types";
import { isEmptySentinel } from "../core/sentinel";
import { parseOptionalSoc } from "../core/validation";
import type { BatteryGridChargeRequest, BatteryOperatingRequest } from "./types";

const OP_MAP: Record<string, BatteryOperatingRequest> = {
	auto: "auto",
	protect: "protect",
	hold: "hold",
	charge: "charge",
	discharge: "discharge",
	off: "off",
};

const GRID_MAP: Record<string, BatteryGridChargeRequest> = {
	auto: "auto",
	allow: "allow",
	deny: "deny",
};

export function normalizeBatteryOperatingRequest(raw: unknown): {
	value: BatteryOperatingRequest;
	status: IntentFieldStatus;
	raw: unknown;
} {
	if (isEmptySentinel(raw)) return { value: "unknown", status: "missing", raw };
	const s = String(raw).trim().toLowerCase();
	const mapped = OP_MAP[s];
	if (mapped) return { value: mapped, status: "valid", raw };
	return { value: "unknown", status: "valid", raw };
}

export function normalizeGridChargeRequest(raw: unknown): {
	value: BatteryGridChargeRequest;
	status: IntentFieldStatus;
	raw: unknown;
} {
	if (isEmptySentinel(raw)) return { value: "unknown", status: "missing", raw };
	const s = String(raw).trim().toLowerCase();
	const mapped = GRID_MAP[s];
	if (mapped) return { value: mapped, status: "valid", raw };
	return { value: "unknown", status: "valid", raw };
}

export function normalizeBatteryTargetSoc(raw: unknown): { value: number | null; status: IntentFieldStatus; raw: unknown } {
	const parsed = parseOptionalSoc(raw);
	return { ...parsed, raw };
}

export function normalizeBooleanIntent(raw: unknown): { value: boolean | null; status: IntentFieldStatus; raw: unknown } {
	if (isEmptySentinel(raw)) return { value: null, status: "missing", raw };
	if (typeof raw === "boolean") return { value: raw, status: "valid", raw };
	const s = String(raw).trim().toLowerCase();
	if (s === "true" || s === "1" || s === "yes" || s === "on") return { value: true, status: "valid", raw };
	if (s === "false" || s === "0" || s === "no" || s === "off") return { value: false, status: "valid", raw };
	return { value: null, status: "invalid", raw };
}
