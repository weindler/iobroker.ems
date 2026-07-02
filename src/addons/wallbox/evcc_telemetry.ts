import type { StateHost } from "../../ems_light/state_util";
import {
	configuredEvccTelemetryStateIds,
	stateIdForRole,
	type WallboxEvccTelemetryConfig,
	type WallboxEvccTelemetryRole,
	wallboxEvccTelemetryConfigFromAdapter,
} from "./evcc_config";
import {
	missingField,
	normalizeOptionalBool,
	normalizeOptionalNumber,
	normalizeOptionalPhases,
	normalizeOptionalSoc,
	normalizeOptionalBatteryMode,
	type TelemetryField,
} from "./normalize";

export type EvccTelemetryReadHost = StateHost & {
	getForeignStateAsync?: (objectId: string) => Promise<ioBroker.State | null | undefined>;
};

export interface EvccTelemetrySnapshot {
	observed_at: string;
	enabled: TelemetryField<boolean>;
	connected: TelemetryField<boolean>;
	charging: TelemetryField<boolean>;
	charge_power_w: TelemetryField<number>;
	session_energy_kwh: TelemetryField<number>;
	vehicle_soc_pct: TelemetryField<number>;
	plan_active: TelemetryField<boolean>;
	plan_soc_pct: TelemetryField<number>;
	plan_time: TelemetryField<string>;
	effective_plan_time: TelemetryField<string>;
	active_phases: TelemetryField<number>;
	configured_phases: TelemetryField<number>;
	min_current_a: TelemetryField<number>;
	max_current_a: TelemetryField<number>;
	battery_mode: TelemetryField<string>;
	battery_discharge_control: TelemetryField<boolean>;
}

const ROLE_NORMALIZER: Record<
	WallboxEvccTelemetryRole,
	(raw: unknown) => TelemetryField<unknown>
> = {
	evcc_enabled: normalizeOptionalBool,
	evcc_connected: normalizeOptionalBool,
	evcc_charging: normalizeOptionalBool,
	evcc_charge_power_w: normalizeOptionalNumber,
	evcc_session_energy_kwh: normalizeSessionEnergyKwh,
	evcc_vehicle_soc: normalizeOptionalSoc,
	evcc_plan_active: normalizeOptionalBool,
	evcc_plan_soc: normalizeOptionalSoc,
	evcc_plan_time: normalizePlanTime,
	evcc_effective_plan_time: normalizePlanTime,
	evcc_active_phases: normalizeOptionalPhases,
	evcc_configured_phases: normalizeOptionalPhases,
	evcc_min_current_a: normalizeOptionalNumber,
	evcc_max_current_a: normalizeOptionalNumber,
	evcc_battery_mode: normalizeOptionalBatteryMode,
	evcc_battery_discharge_control: normalizeOptionalBool,
};

/** EVCC liefert die Sitzungsenergie in Wh; EMS-Light speichert kWh. */
function normalizeSessionEnergyKwh(raw: unknown): TelemetryField<number> {
	const wh = normalizeOptionalNumber(raw);
	if (wh.status !== "valid" || wh.value === null) {
		return wh;
	}
	return { value: wh.value / 1000, status: "valid", raw };
}

/** Gos Null-Zeit (EVCC effectivePlanTime ohne Plan) ist keine gültige Deadline. */
function isZeroTimeSentinel(iso: string): boolean {
	return iso.startsWith("0001-01-01T00:00:00");
}

function planTimeFromIso(iso: string, raw: unknown): TelemetryField<string> {
	if (isZeroTimeSentinel(iso)) {
		return { value: null, status: "invalid", raw };
	}
	return { value: iso, status: "valid", raw };
}

function normalizePlanTime(raw: unknown): TelemetryField<string> {
	if (raw === null || raw === undefined || raw === "") {
		return missingField();
	}
	if (typeof raw === "number" && Number.isFinite(raw)) {
		const ms = raw > 1e12 ? raw : raw * 1000;
		return planTimeFromIso(new Date(ms).toISOString(), raw);
	}
	const s = String(raw).trim();
	if (!s) return missingField();
	const asNum = parseFloat(s);
	if (/^\d+(\.\d+)?$/.test(s) && Number.isFinite(asNum)) {
		const ms = asNum > 1e12 ? asNum : asNum * 1000;
		return planTimeFromIso(new Date(ms).toISOString(), raw);
	}
	const parsed = Date.parse(s);
	if (Number.isFinite(parsed)) {
		return planTimeFromIso(new Date(parsed).toISOString(), raw);
	}
	return { value: null, status: "invalid", raw };
}

async function readForeign(
	host: EvccTelemetryReadHost,
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

function emptySnapshot(observedAt: string): EvccTelemetrySnapshot {
	const m = <T>() => missingField<T>();
	return {
		observed_at: observedAt,
		enabled: m(),
		connected: m(),
		charging: m(),
		charge_power_w: m(),
		session_energy_kwh: m(),
		vehicle_soc_pct: m(),
		plan_active: m(),
		plan_soc_pct: m(),
		plan_time: m(),
		effective_plan_time: m(),
		active_phases: m(),
		configured_phases: m(),
		min_current_a: m(),
		max_current_a: m(),
		battery_mode: m(),
		battery_discharge_control: m(),
	};
}

export async function readEvccTelemetrySnapshot(
	host: EvccTelemetryReadHost,
	cfg: WallboxEvccTelemetryConfig,
	now: Date,
): Promise<EvccTelemetrySnapshot> {
	const observedAt = now.toISOString();
	const ids = configuredEvccTelemetryStateIds(cfg);
	if (ids.length === 0) {
		return emptySnapshot(observedAt);
	}

	const fields: Partial<Record<WallboxEvccTelemetryRole, TelemetryField<unknown>>> = {};

	for (const role of Object.keys(ROLE_NORMALIZER) as WallboxEvccTelemetryRole[]) {
		const stateId = stateIdForRole(cfg, role);
		if (!stateId) {
			fields[role] = missingField();
			continue;
		}
		const st = await readForeign(host, stateId);
		if (!st) {
			fields[role] = missingField();
			continue;
		}
		fields[role] = ROLE_NORMALIZER[role](st.val);
	}

	return {
		observed_at: observedAt,
		enabled: fields.evcc_enabled as TelemetryField<boolean>,
		connected: fields.evcc_connected as TelemetryField<boolean>,
		charging: fields.evcc_charging as TelemetryField<boolean>,
		charge_power_w: fields.evcc_charge_power_w as TelemetryField<number>,
		session_energy_kwh: fields.evcc_session_energy_kwh as TelemetryField<number>,
		vehicle_soc_pct: fields.evcc_vehicle_soc as TelemetryField<number>,
		plan_active: fields.evcc_plan_active as TelemetryField<boolean>,
		plan_soc_pct: fields.evcc_plan_soc as TelemetryField<number>,
		plan_time: fields.evcc_plan_time as TelemetryField<string>,
		effective_plan_time: fields.evcc_effective_plan_time as TelemetryField<string>,
		active_phases: fields.evcc_active_phases as TelemetryField<number>,
		configured_phases: fields.evcc_configured_phases as TelemetryField<number>,
		min_current_a: fields.evcc_min_current_a as TelemetryField<number>,
		max_current_a: fields.evcc_max_current_a as TelemetryField<number>,
		battery_mode: fields.evcc_battery_mode as TelemetryField<string>,
		battery_discharge_control: fields.evcc_battery_discharge_control as TelemetryField<boolean>,
	};
}

export function evccTelemetryConfigFromAdapter(config: unknown): WallboxEvccTelemetryConfig {
	return wallboxEvccTelemetryConfigFromAdapter(config);
}
