import type { ResolvedBatteryIntent } from "../../../intent/battery/types";
import type { BatteryAction, BatteryDeviceIntent, BatteryEnergySource } from "./types";

export interface DeviceIntentResult {
	intent: BatteryDeviceIntent | null;
	/** Gesetzt, wenn die Anforderung strukturiert abgewiesen wurde (z. B. discharge). */
	rejected: string | null;
}

/**
 * Übersetzt den herstellerneutralen, aufgelösten Batterie-Intent in einen
 * geräteorientierten Intent. `discharge` wird hier strukturiert abgewiesen
 * (keine bestätigte Entladesteuerung in dieser Version).
 */
export function deviceIntentFromResolved(
	resolved: ResolvedBatteryIntent,
	options: { source?: string; now?: Date } = {},
): DeviceIntentResult {
	const source = options.source ?? "ems_intent";
	const now = options.now ?? new Date();
	const op = resolved.operating_request.value;
	const targetSoc = resolved.target_soc_pct.status === "valid" ? resolved.target_soc_pct.value : null;
	const gridCharge = resolved.grid_charge_request.value;
	const topOff = resolved.top_off_requested.status === "valid" && resolved.top_off_requested.value === true;

	if (op === "discharge") {
		return { intent: null, rejected: "discharge_not_supported" };
	}

	let action: BatteryAction;
	let energySource: BatteryEnergySource = "any";
	if (topOff) {
		action = "topoff";
		energySource = "any";
	} else if (op === "charge") {
		action = gridCharge === "allow" ? "grid_charge" : "charge";
		energySource = gridCharge === "allow" ? "grid" : "pv";
	} else if (gridCharge === "allow") {
		action = "grid_charge";
		energySource = "grid";
	} else if (op === "hold") {
		action = "hold";
	} else if (op === "protect") {
		action = "protect_reserve";
	} else if (op === "off" || op === "auto" || op === "unknown") {
		action = "self_consumption";
	} else {
		action = "self_consumption";
	}

	const intent: BatteryDeviceIntent = {
		requestId: resolved.target.id
			? `${resolved.domain}-${resolved.revision}`
			: `battery-${resolved.revision}`,
		action,
		targetSocPct: targetSoc,
		maxChargeW: null,
		maxDischargeW: null,
		energySource,
		validFrom: null,
		validUntil: resolved.manual_override.active ? resolved.manual_override.valid_until ?? null : null,
		issuedAt: resolved.resolved_at,
		reason: `op=${op} grid=${gridCharge} topoff=${topOff}`,
		source,
	};
	void now;
	return { intent, rejected: null };
}

/** Aktionen, die einen aktiven Ladevorgang (Modus 1) bedeuten. */
export function isChargingAction(action: BatteryAction): boolean {
	return action === "charge" || action === "grid_charge" || action === "topoff";
}

/** Aktionen, die den sicheren Grundzustand (Self Consumption / Modus 2) bedeuten. */
export function isSafeDefaultAction(action: BatteryAction): boolean {
	return action === "self_consumption" || action === "safe_default" || action === "protect_reserve";
}
