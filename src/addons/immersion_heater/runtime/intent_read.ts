import type { ResolvedThermalIntent } from "../../../intent/thermal/types";
import { controlModeToOperatingRequest, operatingRequestToControlMode } from "./fsm";
import type { ThermalControlMode } from "./types";

export function resolvedModeFromIntent(intent: ResolvedThermalIntent | null): ThermalControlMode {
	if (!intent || intent.intent_state === "disabled") return "auto";
	const op = intent.operating_request.value;
	if (intent.operating_request.status === "valid" && op) {
		return operatingRequestToControlMode(op);
	}
	return "auto";
}

export function forceTargetFromIntent(intent: ResolvedThermalIntent | null): number | null {
	if (!intent || intent.target_temperature_c.status !== "valid") return null;
	return intent.target_temperature_c.value;
}

export function forceUntilFromIntent(intent: ResolvedThermalIntent | null): string | null {
	if (!intent || intent.ready_at.status !== "valid" || !intent.ready_at.value) return null;
	return intent.ready_at.value.at;
}

export function parseResolvedIntentJson(raw: unknown): ResolvedThermalIntent | null {
	if (!raw) return null;
	try {
		const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
		if (parsed && typeof parsed === "object" && parsed.domain === "thermal") {
			return parsed as ResolvedThermalIntent;
		}
	} catch {
		return null;
	}
	return null;
}

export { controlModeToOperatingRequest };
