import { INTENT_SCHEMA_VERSION } from "../core/constants";
import type { IobrokerRequestResult } from "../core/types";
import { immersionDeviceConfigFromAdapter, effectiveForceTarget } from "../../addons/immersion_heater/device_config";
import { controlModeToOperatingRequest } from "../../addons/immersion_heater/runtime/fsm";
import type { ThermalControlMode } from "../../addons/immersion_heater/runtime/types";

export const THERMAL_CONTROL_REQUESTED_MODE = "user_intent.thermal.control.requested_mode";
export const THERMAL_CONTROL_FORCE_TARGET = "user_intent.thermal.control.force_target_temp_c";
export const THERMAL_CONTROL_FORCE_UNTIL = "user_intent.thermal.control.force_until";
export const THERMAL_CONTROL_LAST_RESULT = "user_intent.thermal.control.last_result_json";

const VALID_MODES: ThermalControlMode[] = ["off", "auto", "force"];

export function parseControlMode(raw: unknown): ThermalControlMode | null {
	if (raw === null || raw === undefined || raw === "") return null;
	const s = String(raw).trim().toLowerCase();
	if (VALID_MODES.includes(s as ThermalControlMode)) return s as ThermalControlMode;
	return null;
}

export interface BuildControlRequestInput {
	mode: ThermalControlMode;
	forceTargetTempC: number | null;
	forceUntil: string | null;
	config: unknown;
	issuedAt: string;
}

export function buildControlThermalRequest(input: BuildControlRequestInput): Record<string, unknown> {
	const { mode, forceTargetTempC, forceUntil, config, issuedAt } = input;
	const deviceCfg = immersionDeviceConfigFromAdapter(config);
	const values: Record<string, unknown> = {
		operating_request: controlModeToOperatingRequest(mode),
	};
	if (mode === "force") {
		const target = effectiveForceTarget(deviceCfg, forceTargetTempC);
		values.target_temperature_c = target;
		if (forceUntil) {
			values.ready_at = { at: forceUntil, timezone: "Europe/Berlin" };
		}
	}
	return {
		schema_version: INTENT_SCHEMA_VERSION,
		request_id: `control-${issuedAt}`,
		issued_at: issuedAt,
		owner: { type: "user", id: "local_user" },
		values,
	};
}

export function validateForceTarget(raw: unknown, config: unknown): { ok: true; value: number } | { ok: false; error: string } {
	if (raw === null || raw === undefined || raw === "") {
		const deviceCfg = immersionDeviceConfigFromAdapter(config);
		return { ok: true, value: deviceCfg.planningMaxTempC };
	}
	const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
	if (!Number.isFinite(n)) return { ok: false, error: "invalid_force_target" };
	const deviceCfg = immersionDeviceConfigFromAdapter(config);
	if (n > deviceCfg.planningMaxTempC) return { ok: false, error: "force_target_above_max" };
	if (n < deviceCfg.planningMinTempC) return { ok: false, error: "force_target_below_min" };
	return { ok: true, value: n };
}

export function controlResult(status: string, errors: string[], requestId: string): IobrokerRequestResult {
	return {
		request_id: requestId,
		status: status as IobrokerRequestResult["status"],
		processed_at: new Date().toISOString(),
		revision: 0,
		errors,
	};
}
