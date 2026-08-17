/**
 * Grid-balance live power (v0.1.289) — Mode-2 discharge-Override.
 *
 * Formel (Referenzscript): deficitW = max(0, consumptionW − pvW);
 * targetW = clamp(round(deficitW + offsetW), 0, maxW).
 *
 * Deadband-Default 0 W: auch kleine Restnetzbezüge (z. B. 20–48 W) sind
 * ausregelbar. Admin darf bewusst ein Deadband setzen.
 *
 * Keine 8-s-Stabilisierung. Mode-2-Override muss innerhalb von ~10 s
 * erneut geschrieben werden (Keepalive, unabhängig von der Write-Hysterese).
 */

import {
	GRID_BALANCE_EXECUTION_ENABLED,
	evaluateGridBalanceSafety,
	formatGridBalanceExplain,
	type GridBalanceAuthority,
	type GridBalanceEvConflictKind,
	type GridBalanceSafetyInput,
	type GridBalanceSafetyResult,
} from "./grid_balance_contract";

export const GRID_BALANCE_DEADBAND_DEFAULT_W = 0;
/** Sonnen Mode-2 Override erlischt nach ~10 s — Refresh spätestens hier. */
export const GRID_BALANCE_KEEPALIVE_MAX_MS = 8_000;
export const GRID_BALANCE_EV_POWER_MAX_AGE_MS = 15_000;
/** Unterhalb gilt chargePower nicht als echte Ladeleistung. */
export const GRID_BALANCE_EV_ACTIVE_MIN_W = 200;

export type EvHouseLoadAdjustment = {
	evActive: boolean;
	evChargePowerW: number | null;
	evPowerFresh: boolean;
	adjustedConsumptionW: number;
	blockReason: "" | "ev_power_unknown";
};

export function adjustConsumptionForEv(input: {
	consumptionW: number;
	charging: boolean;
	chargePowerW: number | null;
	chargePowerAgeMs: number | null;
	maxAgeMs?: number;
	vehicleConnected?: boolean | null;
}): EvHouseLoadAdjustment {
	const consumptionW = Number.isFinite(input.consumptionW) ? Math.max(0, input.consumptionW) : 0;
	const power = input.chargePowerW != null && Number.isFinite(input.chargePowerW) ? input.chargePowerW : null;
	const maxAge = input.maxAgeMs ?? GRID_BALANCE_EV_POWER_MAX_AGE_MS;
	const ageOk =
		input.chargePowerAgeMs != null && Number.isFinite(input.chargePowerAgeMs) && input.chargePowerAgeMs >= 0 &&
		input.chargePowerAgeMs <= maxAge;
	const powerPositive = power != null && power > 0;
	const vehiclePresent = input.vehicleConnected !== false;
	const evActive =
		vehiclePresent && (input.charging === true || (power != null && power >= GRID_BALANCE_EV_ACTIVE_MIN_W));
	if (!evActive) {
		return {
			evActive: false,
			evChargePowerW: power,
			evPowerFresh: ageOk && power != null,
			adjustedConsumptionW: consumptionW,
			blockReason: "",
		};
	}
	const freshReal = powerPositive && ageOk;
	if (!freshReal) {
		return {
			evActive: true,
			evChargePowerW: power,
			evPowerFresh: false,
			adjustedConsumptionW: consumptionW,
			blockReason: "ev_power_unknown",
		};
	}
	return {
		evActive: true,
		evChargePowerW: power,
		evPowerFresh: true,
		adjustedConsumptionW: Math.max(0, consumptionW - power!),
		blockReason: "",
	};
}

export function effectiveGridBalanceMaxW(input: {
	configuredMaxW: number;
	hardwareMaxChargeW: number | null;
	hardwareMaxDischargeW: number | null;
}): { configuredMaxW: number; hardwareMaxW: number | null; effectiveMaxW: number } {
	const configuredMaxW = Math.max(0, Math.round(Number.isFinite(input.configuredMaxW) ? input.configuredMaxW : 0));
	const discharge =
		input.hardwareMaxDischargeW != null && input.hardwareMaxDischargeW > 0 ? input.hardwareMaxDischargeW : null;
	const charge = input.hardwareMaxChargeW != null && input.hardwareMaxChargeW > 0 ? input.hardwareMaxChargeW : null;
	/** Sonnen Mode-2 discharge-Override; Hardware-Entladegrenze gilt, sonst Ladegrenze. */
	const hardwareMaxW = discharge ?? charge;
	const effectiveMaxW =
		hardwareMaxW != null ? Math.min(configuredMaxW, Math.round(hardwareMaxW)) : configuredMaxW;
	return { configuredMaxW, hardwareMaxW, effectiveMaxW: Math.max(0, effectiveMaxW) };
}

export type GridBalanceLiveTestState = {
	armed: boolean;
	consumed: boolean;
	armedAtMs: number | null;
	consumedAtMs: number | null;
	result: string;
};

export function emptyGridBalanceLiveTest(): GridBalanceLiveTestState {
	return { armed: false, consumed: false, armedAtMs: null, consumedAtMs: null, result: "" };
}

export function applyGridBalanceLiveTestPulse(
	prev: GridBalanceLiveTestState,
	armedVal: unknown,
	armedAck: boolean | undefined,
	nowMs: number,
): GridBalanceLiveTestState {
	if (armedVal === true && armedAck === false) {
		if (prev.consumed) {
			return { ...prev, armed: false, result: "retries_blocked" };
		}
		return {
			armed: true,
			consumed: false,
			armedAtMs: nowMs,
			consumedAtMs: null,
			result: "armed",
		};
	}
	if (armedVal === false && armedAck === false) {
		return { ...emptyGridBalanceLiveTest(), result: "disarmed" };
	}
	return prev;
}

export function consumeGridBalanceLiveTest(
	prev: GridBalanceLiveTestState,
	nowMs: number,
): GridBalanceLiveTestState {
	if (!prev.armed || prev.consumed) return prev;
	return {
		armed: false,
		consumed: true,
		armedAtMs: prev.armedAtMs,
		consumedAtMs: nowMs,
		result: "consumed",
	};
}

/** Regulärer GB-Discharge-Setpoint (≠ 0) und Mode-2-Keepalive derselben Session. */
export function gridBalanceSetpointPermit(
	liveTest: GridBalanceLiveTestState,
	ownsSetpoint = false,
): boolean {
	return GRID_BALANCE_EXECUTION_ENABLED || (liveTest.armed && !liveTest.consumed) || (ownsSetpoint && liveTest.consumed);
}

/** @deprecated Use gridBalanceSetpointPermit — does not gate the 0-release. */
export function gridBalanceExecutionReleased(liveTest: GridBalanceLiveTestState): boolean {
	return gridBalanceSetpointPermit(liveTest);
}

/** Cleanup/0-Write nur wenn GB den Setpoint besitzt und keine höhere Authority kontert. */
export function gridBalanceCleanupAllowed(input: {
	ownsSetpoint: boolean;
	holdDetected: boolean;
	authority: GridBalanceAuthority;
	blockReason?: string;
}): boolean {
	if (!input.ownsSetpoint) return false;
	if (input.holdDetected) return false;
	if (
		input.authority === "battery_hold" ||
		input.authority === "external_ev" ||
		input.authority === "planned_battery"
	) {
		return false;
	}
	if (input.authority === "safety") {
		const reason = input.blockReason ?? "";
		if (reason === "restore_in_progress" || reason === "fault_lockout") return false;
		// global_dryrun / addon_dryrun / addon_disabled: reguläres Session-Ende, 0-Release bleibt möglich.
	}
	return true;
}

/**
 * Session-0-Release: unabhängig von One-Shot `consumed`.
 * Hold / External / Planned / Safety: kein Cleanup-Write, Ownership fällt.
 */
export function gridBalanceSessionReleasePermit(input: {
	ownsSetpoint: boolean;
	holdDetected: boolean;
	authority: GridBalanceAuthority;
	globalLive: boolean;
	addonLive: boolean;
	faultActive: boolean;
	lockoutActive: boolean;
	restoreInProgress: boolean;
	blockReason?: string;
	/** Live→Dryrun: 0-Release unserer eigenen Live-Session bleibt erlaubt. */
	leavingLiveWithOwnership?: boolean;
}): boolean {
	if (!gridBalanceCleanupAllowed(input)) return false;
	const liveOk =
		(input.globalLive && input.addonLive) || input.leavingLiveWithOwnership === true;
	return liveOk && !input.faultActive && !input.lockoutActive && !input.restoreInProgress;
}

export type GridBalancePowerSnapshot = {
	rawConsumptionW: number;
	evChargePowerW: number | null;
	adjustedConsumptionW: number;
	pvPowerW: number;
	rawGridDeltaW: number;
	deadbandW: number;
	requestedPowerW: number;
	configuredMaxW: number;
	hardwareMaxW: number | null;
	effectiveMaxW: number;
	effectivePowerW: number;
	ownership: boolean;
};

export type GridBalanceTickInput = {
	nowMs: number;
	safety: GridBalanceSafetyInput;
	consumptionW: number;
	pvAcPowerW: number;
	charging: boolean;
	chargePowerW: number | null;
	chargePowerAgeMs: number | null;
	/** false → leftover EVCC charging/power is not house-load EV subtraction. */
	vehicleConnected?: boolean | null;
	deadbandW: number;
	offsetW: number;
	configuredMaxW: number;
	hardwareMaxChargeW: number | null;
	hardwareMaxDischargeW: number | null;
	minChangeW: number;
	lastWrittenW: number | null;
	lastWriteAtMs: number | null;
	ownsSetpoint: boolean;
	liveTest: GridBalanceLiveTestState;
	controllerIsGridBalance: boolean;
	/** Sonnen Mode 2 / self_consumption confirmed from telemetry. */
	mode2Confirmed: boolean;
	keepaliveMaxMs?: number;
	/** Empty if PV-forecast / snow / capacity gates passed. */
	forecastBlockReason: string;
	/** Global Live → Dryrun while this GB session still owns a live setpoint. */
	leavingLiveWithOwnership?: boolean;
};

export type GridBalanceTickDecision = GridBalancePowerSnapshot & {
	enabled: boolean;
	active: boolean;
	ready: boolean;
	blockReason: string;
	currentPriceCt: number | null;
	priceMinCt: number;
	priceAllowed: boolean;
	authority: GridBalanceAuthority;
	holdDetected: boolean;
	evConflict: boolean;
	explain: string;
	shouldWrite: boolean;
	shouldRelease: boolean;
	forceWrite: boolean;
	writePowerW: number;
	writeKind: "discharge";
	ownsSetpointNext: boolean;
	liveTestNext: GridBalanceLiveTestState;
	lastAction: "written" | "keepalive" | "released" | "blocked" | "idle" | "diagnosis_only" | "inside_deadband";
	mode2Confirmed: boolean;
	keepaliveDue: boolean;
	safety: GridBalanceSafetyResult;
	evConflictKind: GridBalanceEvConflictKind;
};

function roundW(n: number): number {
	return Math.max(0, Math.round(n));
}

export function evaluateGridBalanceTick(input: GridBalanceTickInput): GridBalanceTickDecision {
	const liveTestPermit = gridBalanceSetpointPermit(input.liveTest, input.ownsSetpoint);
	const safety = evaluateGridBalanceSafety({ ...input.safety, liveTestPermit });
	const ev = adjustConsumptionForEv({
		consumptionW: input.consumptionW,
		charging: input.charging,
		chargePowerW: input.chargePowerW,
		chargePowerAgeMs: input.chargePowerAgeMs,
		vehicleConnected: input.vehicleConnected,
	});
	const pvPowerW = Number.isFinite(input.pvAcPowerW) ? Math.max(0, input.pvAcPowerW) : 0;
	const rawGridDeltaW = roundW(ev.adjustedConsumptionW - pvPowerW);
	const deadbandW = Math.max(0, Math.round(input.deadbandW));
	const max = effectiveGridBalanceMaxW({
		configuredMaxW: input.configuredMaxW,
		hardwareMaxChargeW: input.hardwareMaxChargeW,
		hardwareMaxDischargeW: input.hardwareMaxDischargeW,
	});
	const exceeds = rawGridDeltaW > deadbandW;
	const unclamped = exceeds ? roundW(rawGridDeltaW + Math.max(0, input.offsetW)) : 0;
	const requestedPowerW = Math.min(max.effectiveMaxW, unclamped);
	const minBenefitW = deadbandW;

	let blockReason = safety.blockReason;
	if (!blockReason && !input.mode2Confirmed) blockReason = "mode_not_self_consumption";
	if (!blockReason && ev.blockReason) blockReason = ev.blockReason;
	if (!blockReason && input.forecastBlockReason) blockReason = input.forecastBlockReason;
	if (!blockReason && !exceeds) blockReason = "inside_deadband";
	if (!blockReason && max.effectiveMaxW <= 0) blockReason = "no_hardware_headroom";
	if (!blockReason && minBenefitW > 0 && requestedPowerW < minBenefitW) blockReason = "below_min_benefit";
	if (!blockReason && !input.controllerIsGridBalance) blockReason = "controller_not_grid_balance";

	const powerEligible = blockReason === "";
	const ready = safety.policyAllowed && ev.blockReason === "" && powerEligible;
	const writeAllowed = safety.writeAllowed && powerEligible;

	let shouldWrite = false;
	let shouldRelease = false;
	let forceWrite = false;
	let writePowerW = 0;
	let ownsNext = input.ownsSetpoint;
	const liveTestNext = input.liveTest;
	let lastAction: GridBalanceTickDecision["lastAction"] = "idle";
	let effectivePowerW = 0;

	const keepaliveMaxMs = input.keepaliveMaxMs ?? GRID_BALANCE_KEEPALIVE_MAX_MS;
	const elapsedSinceWrite =
		input.lastWriteAtMs != null && Number.isFinite(input.lastWriteAtMs) ? input.nowMs - input.lastWriteAtMs : null;
	const keepaliveDue =
		input.ownsSetpoint &&
		requestedPowerW > 0 &&
		writeAllowed &&
		(elapsedSinceWrite === null || elapsedSinceWrite >= keepaliveMaxMs);

	const releasePermit = gridBalanceSessionReleasePermit({
		ownsSetpoint: input.ownsSetpoint,
		holdDetected: safety.holdDetected,
		authority: safety.authority,
		globalLive: input.safety.globalLive,
		addonLive: input.safety.addonLive,
		faultActive: input.safety.faultActive,
		lockoutActive: input.safety.lockoutActive,
		restoreInProgress: input.safety.restoreInProgress,
		blockReason: safety.blockReason,
		leavingLiveWithOwnership: input.leavingLiveWithOwnership === true,
	});

	if (
		!safety.policyAllowed ||
		!input.mode2Confirmed ||
		ev.blockReason ||
		input.forecastBlockReason ||
		!input.controllerIsGridBalance
	) {
		if (releasePermit) {
			shouldRelease = true;
			writePowerW = 0;
			ownsNext = false;
			lastAction = "released";
		} else {
			ownsNext = false;
			lastAction = "blocked";
			if (!safety.writeAllowed && safety.policyAllowed && !ev.blockReason && input.mode2Confirmed) {
				lastAction = GRID_BALANCE_EXECUTION_ENABLED ? "idle" : "diagnosis_only";
			}
		}
	} else if (blockReason === "inside_deadband" || blockReason === "below_min_benefit") {
		if (releasePermit) {
			shouldRelease = true;
			writePowerW = 0;
			ownsNext = false;
			lastAction = "released";
		} else if (blockReason === "inside_deadband") {
			lastAction = "inside_deadband";
		} else {
			lastAction = "blocked";
		}
	} else if (writeAllowed && requestedPowerW > 0) {
		const minChange = Math.max(0, input.minChangeW);
		const firstWrite = !input.ownsSetpoint || input.lastWrittenW === null;
		const delta = firstWrite ? Number.POSITIVE_INFINITY : Math.abs(requestedPowerW - (input.lastWrittenW ?? 0));
		const materialChange = delta >= minChange;
		if (firstWrite || materialChange || keepaliveDue) {
			shouldWrite = true;
			forceWrite = true;
			writePowerW = requestedPowerW;
			effectivePowerW = requestedPowerW;
			ownsNext = true;
			lastAction = !firstWrite && !materialChange && keepaliveDue ? "keepalive" : "written";
		} else {
			effectivePowerW = input.lastWrittenW ?? 0;
			lastAction = "idle";
		}
	} else if (powerEligible && !safety.writeAllowed) {
		lastAction = input.ownsSetpoint ? "idle" : GRID_BALANCE_EXECUTION_ENABLED ? "idle" : "diagnosis_only";
		effectivePowerW = input.ownsSetpoint ? (input.lastWrittenW ?? requestedPowerW) : requestedPowerW;
	}

	const active = shouldWrite || (ownsNext && lastAction !== "released" && lastAction !== "blocked");
	const explain = formatGridBalanceExplain({
		enabled: safety.enabled,
		blockReason,
		priceNowCt: input.safety.priceNowCt,
		priceMinCt: input.safety.priceMinCt,
		gridImportW: rawGridDeltaW,
		active,
		mode2Confirmed: input.mode2Confirmed,
		dischargeW: effectivePowerW || requestedPowerW,
	});

	return {
		enabled: safety.enabled,
		active,
		ready,
		blockReason,
		currentPriceCt: input.safety.priceNowCt,
		priceMinCt: input.safety.priceMinCt,
		priceAllowed: safety.priceAllowed,
		authority: safety.authority,
		holdDetected: safety.holdDetected,
		evConflict: safety.evConflict,
		explain,
		rawConsumptionW: roundW(Number.isFinite(input.consumptionW) ? Math.max(0, input.consumptionW) : 0),
		evChargePowerW: ev.evChargePowerW,
		adjustedConsumptionW: roundW(ev.adjustedConsumptionW),
		pvPowerW: roundW(pvPowerW),
		rawGridDeltaW,
		deadbandW,
		requestedPowerW,
		configuredMaxW: max.configuredMaxW,
		hardwareMaxW: max.hardwareMaxW,
		effectiveMaxW: max.effectiveMaxW,
		effectivePowerW,
		ownership: ownsNext,
		shouldWrite,
		shouldRelease,
		forceWrite,
		writePowerW,
		writeKind: "discharge",
		ownsSetpointNext: ownsNext,
		liveTestNext,
		lastAction,
		mode2Confirmed: input.mode2Confirmed,
		keepaliveDue,
		safety,
		evConflictKind: input.safety.evConflictKind,
	};
}
