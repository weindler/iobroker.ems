/**
 * EVCC mode-control variants (v0.1.274).
 * buttons = current ioBroker/EVCC interface; pv_control and string_mode remain legacy.
 * Diagnosis only — no live writes in this phase.
 */

import { ADMIN_INTENT_EVCC_MODE_STATE } from "../../intent/core/constants";
import { WB_EVCC_LOADPOINT_MODE } from "./evcc_config";
import {
	evccControlTargetForRole,
	evccModeChargeValue,
	EVCC_BUTTON_SUFFIXES,
	EVCC_CONTROL_V1_SUFFIXES,
	matchesEvccControlSuffix,
	resolveEvccControlContractV1,
	strConfigField,
	WB_EVCC_CONTROL_MIN,
	WB_EVCC_CONTROL_NOW,
	WB_EVCC_CONTROL_OFF,
	WB_EVCC_CONTROL_PV,
	WB_EVCC_MODE_CONTROL,
	type EvccControlContractModel,
	type WallboxControlModel,
} from "./evcc_control_config";

export {
	EVCC_BUTTON_SUFFIXES,
	WB_EVCC_CONTROL_MIN,
	WB_EVCC_CONTROL_NOW,
	WB_EVCC_CONTROL_OFF,
	WB_EVCC_CONTROL_PV,
	WB_EVCC_MODE_CONTROL,
};

export const EVCC_MODE_FEEDBACK_SUFFIX = "status.mode";

export type EvccModeButton = keyof typeof EVCC_BUTTON_SUFFIXES;

export type EvccModeControlRequested = "auto" | "buttons" | "pv_control" | "string_mode";

export type EvccModeControlVariant = "none" | "buttons" | "pv_control" | "string_mode";

export const EVCC_MODE_CONTROL_REQUESTED = [
	"auto",
	"buttons",
	"pv_control",
	"string_mode",
] as const;

export const EVCC_FEEDBACK_MODE_VALUES = ["off", "pv", "min", "now"] as const;

export type EvccFeedbackModeValue = (typeof EVCC_FEEDBACK_MODE_VALUES)[number];

function rejectDirectGoeId(stateId: string): string {
	const id = stateId.trim();
	if (!id) return "";
	if (id.toLowerCase().startsWith("go-e.")) return "";
	return id;
}

function pickMatchingId(c: Record<string, unknown>, key: string, suffix: string): string {
	const dedicated = rejectDirectGoeId(strConfigField(c, key));
	if (dedicated && matchesEvccControlSuffix(dedicated, suffix)) return dedicated;
	return "";
}

export function parseEvccModeControlRequested(raw: unknown): EvccModeControlRequested {
	const s = String(raw ?? "auto").trim().toLowerCase();
	if (s === "buttons" || s === "pv_control" || s === "string_mode") return s;
	return "auto";
}

export function isEvccModeFeedbackStateId(stateId: string): boolean {
	const id = rejectDirectGoeId(stateId);
	if (!id) return false;
	return matchesEvccControlSuffix(id, EVCC_MODE_FEEDBACK_SUFFIX);
}

export function isEvccModeButtonStateId(stateId: string, button: EvccModeButton): boolean {
	const id = rejectDirectGoeId(stateId);
	if (!id) return false;
	return matchesEvccControlSuffix(id, EVCC_BUTTON_SUFFIXES[button]);
}

/** status.mode is feedback — never a write target. */
export function resolveEvccModeFeedbackStateId(config: unknown): string {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const loadpoint = rejectDirectGoeId(strConfigField(c, WB_EVCC_LOADPOINT_MODE));
	if (loadpoint && isEvccModeFeedbackStateId(loadpoint)) return loadpoint;
	if (loadpoint && loadpoint.toLowerCase().startsWith("evcc.") && loadpoint.toLowerCase().includes("mode")) {
		return loadpoint;
	}
	const intent = rejectDirectGoeId(strConfigField(c, ADMIN_INTENT_EVCC_MODE_STATE));
	if (intent && isEvccModeFeedbackStateId(intent)) return intent;
	if (intent && intent.toLowerCase().startsWith("evcc.") && intent.toLowerCase().includes("mode")) {
		return intent;
	}
	return "";
}

export function pickEvccButtonStateId(config: unknown, button: EvccModeButton): string {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const keys: Record<EvccModeButton, string> = {
		off: WB_EVCC_CONTROL_OFF,
		pv: WB_EVCC_CONTROL_PV,
		min: WB_EVCC_CONTROL_MIN,
		now: WB_EVCC_CONTROL_NOW,
	};
	return pickMatchingId(c, keys[button], EVCC_BUTTON_SUFFIXES[button]);
}

export function stringModeContractComplete(config: unknown): boolean {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	return (
		evccControlTargetForRole(c, "set_mode").length > 0 &&
		evccControlTargetForRole(c, "set_max_current_a").length > 0 &&
		evccModeChargeValue(c).length > 0
	);
}

export interface EvccModeControlContract {
	requestedVariant: EvccModeControlRequested;
	resolvedVariant: EvccModeControlVariant;
	modeFeedbackStateId: string;
	offStateId: string;
	pvStateId: string;
	minStateId: string;
	nowStateId: string;
	buttonReady: Record<EvccModeButton, boolean>;
	buttonsReady: boolean;
	pvControlStateId: string;
	maxCurrentStateId: string;
	phasesConfiguredStateId: string;
	modeContractReady: boolean;
	writeContractReady: boolean;
	missing: string[];
	usesLegacyGoeFallback: false;
	detail: Record<string, unknown>;
}

function autoDetectVariant(input: {
	anyButtonMapped: boolean;
	pvControlMapped: boolean;
	stringModeComplete: boolean;
}): EvccModeControlVariant {
	if (input.anyButtonMapped) return "buttons";
	if (input.pvControlMapped) return "pv_control";
	if (input.stringModeComplete) return "string_mode";
	return "buttons";
}

/**
 * Resolves the active EVCC mode-control variant and structural completeness.
 * Never falls back to go-e. pvControl does not affect the buttons variant.
 */
export function resolveEvccModeControlContract(config: unknown): EvccModeControlContract {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const requestedVariant = parseEvccModeControlRequested(c[WB_EVCC_MODE_CONTROL]);
	const offStateId = pickEvccButtonStateId(c, "off");
	const pvStateId = pickEvccButtonStateId(c, "pv");
	const minStateId = pickEvccButtonStateId(c, "min");
	const nowStateId = pickEvccButtonStateId(c, "now");
	const buttonReady: Record<EvccModeButton, boolean> = {
		off: Boolean(offStateId),
		pv: Boolean(pvStateId),
		min: Boolean(minStateId),
		now: Boolean(nowStateId),
	};
	const anyButtonMapped = Object.values(buttonReady).some(Boolean);
	const modeFeedbackStateId = resolveEvccModeFeedbackStateId(c);
	const v1 = resolveEvccControlContractV1(c);
	const stringComplete = stringModeContractComplete(c);
	const resolvedVariant: EvccModeControlVariant =
		requestedVariant === "auto"
			? autoDetectVariant({
					anyButtonMapped,
					pvControlMapped: Boolean(v1.pvControlStateId),
					stringModeComplete: stringComplete,
				})
			: requestedVariant;

	const buttonsModeReady = buttonReady.off && buttonReady.pv && buttonReady.min && buttonReady.now;
	const buttonsReady = buttonsModeReady && Boolean(modeFeedbackStateId);
	const maxCurrentStateId = v1.maxCurrentStateId;
	const phasesConfiguredStateId = v1.phasesConfiguredStateId;

	const missing: string[] = [];
	let modeContractReady = false;
	let writeContractReady = false;

	if (resolvedVariant === "buttons") {
		if (!buttonReady.off) missing.push(EVCC_BUTTON_SUFFIXES.off);
		if (!buttonReady.pv) missing.push(EVCC_BUTTON_SUFFIXES.pv);
		if (!buttonReady.min) missing.push(EVCC_BUTTON_SUFFIXES.min);
		if (!buttonReady.now) missing.push(EVCC_BUTTON_SUFFIXES.now);
		if (!modeFeedbackStateId) missing.push(EVCC_MODE_FEEDBACK_SUFFIX);
		modeContractReady = buttonsReady;
		if (!maxCurrentStateId) missing.push(EVCC_CONTROL_V1_SUFFIXES.maxCurrent);
		if (!phasesConfiguredStateId) missing.push(EVCC_CONTROL_V1_SUFFIXES.phasesConfigured);
		writeContractReady = modeContractReady && Boolean(maxCurrentStateId) && Boolean(phasesConfiguredStateId);
	} else if (resolvedVariant === "pv_control") {
		missing.push(...v1.missing);
		modeContractReady = Boolean(v1.pvControlStateId);
		writeContractReady = v1.ready;
	} else if (resolvedVariant === "string_mode") {
		if (!evccControlTargetForRole(c, "set_mode")) missing.push("set_mode");
		if (!evccControlTargetForRole(c, "set_max_current_a")) missing.push("set_max_current_a");
		if (!evccModeChargeValue(c)) missing.push("evcc_charge_mode_value");
		modeContractReady = stringComplete;
		writeContractReady = stringComplete;
	}

	const detail = {
		requestedVariant,
		resolvedVariant,
		modeFeedbackStateId: modeFeedbackStateId || null,
		buttons: {
			off: offStateId || null,
			pv: pvStateId || null,
			min: minStateId || null,
			now: nowStateId || null,
			ready: buttonsReady,
		},
		pvControlStateId: v1.pvControlStateId || null,
		maxCurrentStateId: maxCurrentStateId || null,
		phasesConfiguredStateId: phasesConfiguredStateId || null,
		modeContractReady,
		writeContractReady,
		missing,
		pvControlIgnoredForButtons: resolvedVariant === "buttons",
		requiresChargeModeValue: resolvedVariant === "string_mode",
		requiresPvControl: resolvedVariant === "pv_control",
		usesLegacyGoeFallback: false,
		liveDispatchSupported: false,
	};

	return {
		requestedVariant,
		resolvedVariant,
		modeFeedbackStateId,
		offStateId,
		pvStateId,
		minStateId,
		nowStateId,
		buttonReady,
		buttonsReady,
		pvControlStateId: v1.pvControlStateId,
		maxCurrentStateId,
		phasesConfiguredStateId,
		modeContractReady,
		writeContractReady,
		missing,
		usesLegacyGoeFallback: false,
		detail,
	};
}

export function controlContractModelFromVariant(
	controlModel: WallboxControlModel,
	variant: EvccModeControlVariant,
): EvccControlContractModel {
	if (controlModel === "none") return "none";
	if (controlModel === "legacy_direct") return "legacy_direct";
	if (variant === "buttons") return "evcc_buttons";
	if (variant === "pv_control") return "evcc_control_v1";
	if (variant === "string_mode") return "evcc_string_mode";
	return "evcc_buttons";
}

export function collectEvccButtonWriteStateIds(contract: EvccModeControlContract): string[] {
	return [contract.offStateId, contract.pvStateId, contract.minStateId, contract.nowStateId].filter(
		(id) => id.length > 0,
	);
}
