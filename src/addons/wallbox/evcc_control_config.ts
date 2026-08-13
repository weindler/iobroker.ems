import { hasLegacyWallboxWriteMapping } from "./evcc_config";
import {
	legacyWallboxMappingFromConfig,
	WALLBOX_FLAT_PREFIX,
} from "../../mapping_config";

/** Auswahl des Wallbox-Steuerpfads (Admin: wb_control_model). */
export const WB_CONTROL_MODEL = "wb_control_model";

/** EVCC-Control-Write-Mappings (getrennt von Legacy wb_set_* und read-only wb_evcc_* Telemetrie). */
export const WB_EVCC_SET_MODE = "wb_evcc_set_mode_target";
export const WB_EVCC_SET_MAX_CURRENT_A = "wb_evcc_set_max_current_a_target";
export const WB_EVCC_SET_PHASE = "wb_evcc_set_phase_target";

/** Future EVCC control.* contract (v0.1.272: diagnose only — not live-released). */
export const WB_EVCC_CONTROL_PV_CONTROL = "wb_evcc_control_pv_control_target";
export const WB_EVCC_CONTROL_MAX_CURRENT = "wb_evcc_control_max_current_target";
export const WB_EVCC_CONTROL_PHASES_CONFIGURED = "wb_evcc_control_phases_configured_target";

export const EVCC_CONTROL_V1_SUFFIXES = {
	pvControl: "control.pvControl",
	maxCurrent: "control.maxCurrent",
	phasesConfigured: "control.phasesConfigured",
} as const;

export type EvccControlContractModel = "none" | "legacy_direct" | "evcc_string_mode" | "evcc_control_v1";

/** Explizite Mode-Werte — keine hardcodierten Modusnamen im Runtime-Code. */
export const WB_EVCC_MODE_CHARGE_VALUE = "wb_evcc_mode_charge_value";
export const WB_EVCC_MODE_HOLD_VALUE = "wb_evcc_mode_hold_value";

export type WallboxControlModel = "none" | "evcc" | "legacy_direct";

export const WALLBOX_CONTROL_MODELS = ["none", "evcc", "legacy_direct"] as const;

/** EVCC-Control-Rollen — semantisch bestätigt, nicht minCurrent/enabled. */
export const WALLBOX_EVCC_CONTROL_ROLES = ["set_mode", "set_max_current_a", "set_phase"] as const;

export type WallboxEvccControlRole = (typeof WALLBOX_EVCC_CONTROL_ROLES)[number];

function strTarget(c: Record<string, unknown>, key: string): string {
	const v = c[key];
	return typeof v === "string" ? v.trim() : "";
}

export function strConfigField(c: Record<string, unknown>, key: string): string {
	return strTarget(c, key);
}

function rejectDirectGoeId(stateId: string): string {
	const id = stateId.trim();
	if (!id) return "";
	if (id.toLowerCase().startsWith("go-e.")) return "";
	return id;
}

export function matchesEvccControlSuffix(stateId: string, suffix: string): boolean {
	const id = stateId.trim().replace(/\.+/g, ".").toLowerCase();
	if (!id.startsWith("evcc.")) return false;
	const s = suffix.trim().replace(/\.+/g, ".").toLowerCase();
	return id.endsWith(`.${s}`) || id.endsWith(s);
}

export interface EvccControlContractV1 {
	pvControlStateId: string;
	maxCurrentStateId: string;
	phasesConfiguredStateId: string;
	ready: boolean;
	missing: string[];
	usesLegacyGoeFallback: false;
}

function pickControlV1Id(c: Record<string, unknown>, dedicatedKey: string, suffix: string, fallbackKey?: string): string {
	const dedicated = rejectDirectGoeId(strTarget(c, dedicatedKey));
	if (dedicated && matchesEvccControlSuffix(dedicated, suffix)) return dedicated;
	if (fallbackKey) {
		const fallback = rejectDirectGoeId(strTarget(c, fallbackKey));
		if (fallback && matchesEvccControlSuffix(fallback, suffix)) return fallback;
	}
	return "";
}

/**
 * Structural EVCC control.* contract. Never falls back to go-e mappings.
 * Ready when all three targets are mapped; not a live-write release.
 */
export function resolveEvccControlContractV1(config: unknown): EvccControlContractV1 {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const pvControlStateId = pickControlV1Id(c, WB_EVCC_CONTROL_PV_CONTROL, EVCC_CONTROL_V1_SUFFIXES.pvControl);
	const maxCurrentStateId = pickControlV1Id(
		c,
		WB_EVCC_CONTROL_MAX_CURRENT,
		EVCC_CONTROL_V1_SUFFIXES.maxCurrent,
		WB_EVCC_SET_MAX_CURRENT_A,
	);
	const phasesConfiguredStateId = pickControlV1Id(
		c,
		WB_EVCC_CONTROL_PHASES_CONFIGURED,
		EVCC_CONTROL_V1_SUFFIXES.phasesConfigured,
		WB_EVCC_SET_PHASE,
	);
	const missing: string[] = [];
	if (!pvControlStateId) missing.push(EVCC_CONTROL_V1_SUFFIXES.pvControl);
	if (!maxCurrentStateId) missing.push(EVCC_CONTROL_V1_SUFFIXES.maxCurrent);
	if (!phasesConfiguredStateId) missing.push(EVCC_CONTROL_V1_SUFFIXES.phasesConfigured);
	return {
		pvControlStateId,
		maxCurrentStateId,
		phasesConfiguredStateId,
		ready: missing.length === 0,
		missing,
		usesLegacyGoeFallback: false,
	};
}

export function resolveControlContractModel(
	controlModel: WallboxControlModel,
	contractV1Ready: boolean,
	stringModeComplete: boolean,
): EvccControlContractModel {
	if (controlModel === "none") return "none";
	if (controlModel === "legacy_direct") return "legacy_direct";
	if (contractV1Ready) return "evcc_control_v1";
	if (stringModeComplete) return "evcc_string_mode";
	return "evcc_control_v1";
}

export function hasEvccControlWriteMapping(config: unknown): boolean {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const keys = [
		WB_EVCC_SET_MODE,
		WB_EVCC_SET_MAX_CURRENT_A,
		WB_EVCC_SET_PHASE,
		WB_EVCC_CONTROL_PV_CONTROL,
		WB_EVCC_CONTROL_MAX_CURRENT,
		WB_EVCC_CONTROL_PHASES_CONFIGURED,
	];
	return keys.some((k) => strTarget(c, k).length > 0);
}

export function resolveWallboxControlModel(config: unknown): WallboxControlModel {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const explicit = c[WB_CONTROL_MODEL];
	if (explicit === "none" || explicit === "evcc" || explicit === "legacy_direct") {
		return explicit;
	}
	if (hasLegacyWallboxWriteMapping(c)) {
		return "none";
	}
	return "evcc";
}

export function evccControlTargetForRole(
	config: Record<string, unknown>,
	role: WallboxEvccControlRole,
): string {
	const keyMap: Record<WallboxEvccControlRole, string> = {
		set_mode: WB_EVCC_SET_MODE,
		set_max_current_a: WB_EVCC_SET_MAX_CURRENT_A,
		set_phase: WB_EVCC_SET_PHASE,
	};
	return strTarget(config, keyMap[role]);
}

export function evccModeChargeValue(config: Record<string, unknown>): string {
	return strTarget(config, WB_EVCC_MODE_CHARGE_VALUE);
}

export function evccModeHoldValue(config: Record<string, unknown>): string {
	return strTarget(config, WB_EVCC_MODE_HOLD_VALUE);
}

/** Sammelt konfigurierte Write-Ziel-IDs für read-only Objektprüfung (ohne Snapshot). */
export function collectConfiguredControlTargetStateIds(config: Record<string, unknown>): string[] {
	const model = resolveWallboxControlModel(config);
	const ids: string[] = [];
	if (model === "evcc") {
		for (const role of WALLBOX_EVCC_CONTROL_ROLES) {
			const id = rejectDirectGoeId(evccControlTargetForRole(config, role));
			if (id) ids.push(id);
		}
		const contract = resolveEvccControlContractV1(config);
		for (const id of [contract.pvControlStateId, contract.maxCurrentStateId, contract.phasesConfiguredStateId]) {
			if (id) ids.push(id);
		}
		return [...new Set(ids)];
	}
	if (model === "legacy_direct") {
		const legacy = legacyWallboxMappingFromConfig(config);
		for (const cmd of ["set_enabled", "set_current_a", "set_charge_power_w"] as const) {
			const prefix = WALLBOX_FLAT_PREFIX[cmd];
			const t = legacy[cmd]?.target_state?.trim();
			const flat =
				typeof config[`${prefix}_target`] === "string" ? String(config[`${prefix}_target`]).trim() : "";
			const id = t || flat;
			if (id) ids.push(id);
		}
	}
	return ids;
}
