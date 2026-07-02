import type { IntentField } from "../core/types";
import type { StateHost } from "../../ems_light/state_util";
import type { WallboxEvccTelemetryConfig } from "../../addons/wallbox/evcc_config";
import { stateIdForRole } from "../../addons/wallbox/evcc_config";
import type { EvccReadHost } from "./evcc";
import type { BatteryGridChargeRequest, BatteryOperatingRequest } from "../battery/types";

export interface EvccBatteryIntentSnapshot {
	observed_at: string;
	operating_request: IntentField<BatteryOperatingRequest> | null;
	ev_discharge_allowed: IntentField<boolean> | null;
	grid_charge_request: IntentField<BatteryGridChargeRequest> | null;
}

async function readForeign(
	host: EvccReadHost,
	objectId: string,
): Promise<{ val: unknown; ts?: number } | null> {
	if (!objectId) return null;
	if (host.getForeignStateAsync) {
		const st = await host.getForeignStateAsync(objectId);
		if (!st || st.val === undefined) return null;
		return { val: st.val, ts: st.ts };
	}
	const st = await host.getStateAsync(objectId);
	if (!st || st.val === undefined) return null;
	return { val: st.val, ts: st.ts };
}

function makeField<T>(
	value: T | null,
	status: import("../core/types").IntentFieldStatus,
	observedAt: string,
	raw: unknown,
): IntentField<T> {
	return {
		value,
		status,
		origin: { source: "evcc", owner: "evcc", change_kind: "unknown" },
		observed_at: observedAt,
		raw_value: raw,
	};
}

function parseDischargeControl(raw: unknown): boolean | null {
	if (typeof raw === "boolean") return raw;
	if (typeof raw === "number" && Number.isFinite(raw)) return raw !== 0;
	const s = String(raw).trim().toLowerCase();
	if (["1", "true", "on", "yes", "ja"].includes(s)) return true;
	if (["0", "false", "off", "no", "nein"].includes(s)) return false;
	return null;
}

function parseBatteryMode(raw: unknown): string | null {
	if (typeof raw === "number" && Number.isFinite(raw)) {
		const map: Record<number, string> = { 0: "unknown", 1: "normal", 2: "hold", 3: "charge", 4: "holdcharge" };
		return map[raw] ?? null;
	}
	const s = String(raw).trim().toLowerCase();
	if (!s) return null;
	if (["normal", "hold", "charge", "holdcharge", "unknown"].includes(s)) return s;
	return null;
}

function constraintFieldsFromMode(
	mode: string,
	observedAt: string,
	rawMode: unknown,
): Pick<EvccBatteryIntentSnapshot, "operating_request" | "ev_discharge_allowed" | "grid_charge_request"> {
	if (mode === "hold" || mode === "holdcharge") {
		return {
			operating_request: makeField<BatteryOperatingRequest>("hold", "valid", observedAt, rawMode),
			ev_discharge_allowed: makeField(false, "valid", observedAt, rawMode),
			grid_charge_request: null,
		};
	}
	if (mode === "charge") {
		return {
			operating_request: makeField<BatteryOperatingRequest>("charge", "valid", observedAt, rawMode),
			ev_discharge_allowed: null,
			grid_charge_request: makeField<BatteryGridChargeRequest>("allow", "valid", observedAt, rawMode),
		};
	}
	return { operating_request: null, ev_discharge_allowed: null, grid_charge_request: null };
}

export async function readEvccBatteryIntentSnapshot(
	host: EvccReadHost & StateHost,
	cfg: WallboxEvccTelemetryConfig,
	now: Date,
): Promise<EvccBatteryIntentSnapshot> {
	const observedAt = now.toISOString();
	const dischargeId = stateIdForRole(cfg, "evcc_battery_discharge_control");
	const modeId = stateIdForRole(cfg, "evcc_battery_mode");
	if (!dischargeId && !modeId) {
		return { observed_at: observedAt, operating_request: null, ev_discharge_allowed: null, grid_charge_request: null };
	}

	const dischargeSt = dischargeId ? await readForeign(host, dischargeId) : null;
	const modeSt = modeId ? await readForeign(host, modeId) : null;

	const dischargeControl = dischargeSt ? parseDischargeControl(dischargeSt.val) : null;
	if (dischargeControl !== true) {
		return { observed_at: observedAt, operating_request: null, ev_discharge_allowed: null, grid_charge_request: null };
	}

	const mode = modeSt ? parseBatteryMode(modeSt.val) : null;
	if (!mode || mode === "normal" || mode === "unknown") {
		return { observed_at: observedAt, operating_request: null, ev_discharge_allowed: null, grid_charge_request: null };
	}

	const fields = constraintFieldsFromMode(mode, observedAt, modeSt?.val);
	return { observed_at: observedAt, ...fields };
}
