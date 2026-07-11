import type { ResolvedBatteryIntent } from "../../../intent/battery/types";
import { deviceIntentFromResolved, isChargingAction } from "../core/intent";
import type { BatteryDeviceIntent } from "../core/types";

export function parseResolvedBatteryIntentJson(raw: unknown): ResolvedBatteryIntent | null {
	if (!raw) return null;
	try {
		const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
		if (parsed && typeof parsed === "object" && parsed.domain === "battery") {
			return parsed as ResolvedBatteryIntent;
		}
	} catch {
		return null;
	}
	return null;
}

export function resolvedIntentHasManualPriority(intent: ResolvedBatteryIntent): boolean {
	if (intent.intent_state === "disabled" || intent.intent_state === "not_configured") return false;
	if (intent.manual_override.active) {
		if (intent.manual_override.valid_until) {
			const until = Date.parse(intent.manual_override.valid_until);
			if (Number.isFinite(until) && until <= Date.now()) return false;
		}
		return true;
	}
	if (intent.operating_request.status === "valid") {
		const op = intent.operating_request.value;
		const kind = intent.operating_request.origin?.change_kind;
		const manualKind = kind === "manual_explicit" || kind === "manual_inferred";
		if (manualKind && op !== null && op !== "auto" && op !== "unknown") return true;
	}
	return false;
}

export function resolvedIntentHasConstraint(intent: ResolvedBatteryIntent): boolean {
	if (intent.intent_state === "disabled" || intent.intent_state === "not_configured") return false;
	const fields = [
		intent.operating_request,
		intent.target_soc_pct,
		intent.grid_charge_request,
		intent.ev_discharge_allowed,
		intent.top_off_requested,
	];
	return fields.some((f) => f.status === "valid");
}

export interface ResolvedDeviceIntentResult {
	intent: BatteryDeviceIntent;
	wantsCharge: boolean;
	rejected: string | null;
}

export function deviceIntentFromResolvedBattery(
	resolved: ResolvedBatteryIntent,
): ResolvedDeviceIntentResult | null {
	const { intent, rejected } = deviceIntentFromResolved(resolved, { source: "user_intent" });
	if (!intent) return null;
	return { intent, wantsCharge: isChargingAction(intent.action), rejected };
}
