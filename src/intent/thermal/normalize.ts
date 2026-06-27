import type { IntentFieldStatus } from "../core/types";
import { isEmptySentinel } from "../core/sentinel";
import type { ThermalOperatingRequest, ThermalPriority } from "./types";
import { normalizeDeadline } from "../wallbox/normalize";

const OP_MAP: Record<string, ThermalOperatingRequest> = {
	off: "off",
	auto: "auto",
	force_on: "force_on",
	forceon: "force_on",
	force_off: "force_off",
	forceoff: "force_off",
};

const PRIO_MAP: Record<string, ThermalPriority> = {
	normal: "normal",
	before_ev: "before_ev",
	after_ev: "after_ev",
};

export function normalizeOperatingRequest(raw: unknown): {
	value: ThermalOperatingRequest;
	status: IntentFieldStatus;
	raw: unknown;
} {
	if (isEmptySentinel(raw)) return { value: "unknown", status: "missing", raw };
	const s = String(raw).trim().toLowerCase();
	const mapped = OP_MAP[s];
	if (mapped) return { value: mapped, status: "valid", raw };
	return { value: "unknown", status: "valid", raw };
}

export function normalizeThermalPriority(raw: unknown): {
	value: ThermalPriority;
	status: IntentFieldStatus;
	raw: unknown;
} {
	if (isEmptySentinel(raw)) return { value: "unknown", status: "missing", raw };
	const s = String(raw).trim().toLowerCase();
	const mapped = PRIO_MAP[s];
	if (mapped) return { value: mapped, status: "valid", raw };
	return { value: "unknown", status: "valid", raw };
}

export function normalizeTargetTemperature(raw: unknown): {
	value: number | null;
	status: IntentFieldStatus;
	raw: unknown;
} {
	if (isEmptySentinel(raw)) return { value: null, status: "missing", raw };
	const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", ".").trim());
	if (!Number.isFinite(n)) return { value: null, status: "invalid", raw };
	if (n < 0 || n > 120) return { value: null, status: "invalid", raw };
	return { value: n, status: "valid", raw };
}

export { normalizeDeadline as normalizeThermalReadyAt };
