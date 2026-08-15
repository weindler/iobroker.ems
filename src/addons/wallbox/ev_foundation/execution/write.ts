/**
 * Only EVCC button pulses (control.off/pv/min/now).
 * Never pvControl, go-e, Ford, Tibber, Sonnen, or HA charge writes.
 */

import { writeForeignIfChanged, type DeviceWriteHost } from "../../../../device_write";
import {
	isEvccModeButtonStateId,
	type EvccModeButton,
	type EvccModeControlContract,
} from "../../evcc_mode_control";
import { classifyEvccPlannerWriteTarget, EV_EXECUTION_PHASE5_ENABLED } from "../write_allowlist";
import type { EvExecutionMode } from "./types";

const FORBIDDEN_PREFIXES = ["go-e.", "fordpass.", "ford.", "tibber.", "sonnen.", "homeassistant."];

export function buttonForMode(mode: EvExecutionMode): EvccModeButton {
	return mode;
}

export function buttonStateId(contract: EvccModeControlContract, button: EvccModeButton): string {
	switch (button) {
		case "off":
			return contract.offStateId;
		case "pv":
			return contract.pvStateId;
		case "min":
			return contract.minStateId;
		case "now":
			return contract.nowStateId;
	}
}

export function isAllowedEvccButtonWriteTarget(stateId: string, button: EvccModeButton): boolean {
	const id = stateId.trim();
	if (!id) return false;
	const lower = id.toLowerCase();
	if (FORBIDDEN_PREFIXES.some((p) => lower.startsWith(p))) return false;
	if (lower.includes("control.pvcontrol")) return false;
	if (!isEvccModeButtonStateId(id, button)) return false;
	return classifyEvccPlannerWriteTarget(id) === "allowed";
}

export interface EvExecutionWriteResult {
	attempted: boolean;
	written: boolean;
	skipped: boolean;
	blocked: boolean;
	reason: string;
	targetStateId: string;
}

export async function executeEvccButtonWrite(
	host: DeviceWriteHost,
	input: {
		contract: EvccModeControlContract;
		mode: EvExecutionMode;
		writeAllowed: boolean;
		liveTestPermit?: boolean;
	},
): Promise<EvExecutionWriteResult> {
	const released = EV_EXECUTION_PHASE5_ENABLED || input.liveTestPermit === true;
	if (!released || !input.writeAllowed) {
		return {
			attempted: false,
			written: false,
			skipped: false,
			blocked: true,
			reason: released ? "write_not_allowed" : "feature_gate",
			targetStateId: "",
		};
	}
	if (input.contract.resolvedVariant !== "buttons") {
		return {
			attempted: false,
			written: false,
			skipped: false,
			blocked: true,
			reason: "legacy_variant_blocked",
			targetStateId: input.contract.pvControlStateId,
		};
	}
	const button = buttonForMode(input.mode);
	const targetStateId = buttonStateId(input.contract, button);
	if (!isAllowedEvccButtonWriteTarget(targetStateId, button)) {
		return {
			attempted: false,
			written: false,
			skipped: false,
			blocked: true,
			reason: "button_target_rejected",
			targetStateId,
		};
	}
	const r = await writeForeignIfChanged(host, {
		stateId: targetStateId,
		value: true,
		reason: `ev_execution button ${button}`,
		force: true,
	});
	return {
		attempted: !r.blocked,
		written: r.written,
		skipped: r.skipped,
		blocked: r.blocked === true,
		reason: r.blocked ? (r.blockReason ?? "write_blocked") : r.written ? "written" : "skipped",
		targetStateId,
	};
}
