/**
 * Grid-balance live hardening (v0.1.284) — EV-Abzug, Deadband, Stabilisierung,
 * Mindestnutzen, Hardware-Clamp, Ownership/Exit. Rein, ohne ioBroker.
 *
 * Deadband-Default 250 W: über typischem Sonnen-/Zählerrauschen (~50–150 W) und
 * über der 50-W-Write-Hysterese; unterhalb sinnvoller Hauslast. 80-W-Mikroregelung
 * (~0,8 kWh/Tag bei Dauerbetrieb) liegt klar im Deadband.
 *
 * Stabilisierung Default 8 s: länger als 500-ms-Debounce und Kompressorstarts
 * (1–3 s), kurz genug für echte Last.
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

export const GRID_BALANCE_DEADBAND_DEFAULT_W = 250;
export const GRID_BALANCE_MIN_DURATION_DEFAULT_S = 8;
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
}): EvHouseLoadAdjustment {
	const consumptionW = Number.isFinite(input.consumptionW) ? Math.max(0, input.consumptionW) : 0;
	const power = input.chargePowerW != null && Number.isFinite(input.chargePowerW) ? input.chargePowerW : null;
	const maxAge = input.maxAgeMs ?? GRID_BALANCE_EV_POWER_MAX_AGE_MS;
	const ageOk =
		input.chargePowerAgeMs != null && Number.isFinite(input.chargePowerAgeMs) && input.chargePowerAgeMs >= 0 &&
		input.chargePowerAgeMs <= maxAge;
	const powerPositive = power != null && power > 0;
	const evActive = input.charging === true || (power != null && power >= GRID_BALANCE_EV_ACTIVE_MIN_W);
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
	/** Sonnen schreibt control.charge; HW-Entladegrenze gilt, sonst Ladegrenze. */
	const hardwareMaxW = discharge ?? charge;
	const effectiveMaxW =
		hardwareMaxW != null ? Math.min(configuredMaxW, Math.round(hardwareMaxW)) : configuredMaxW;
	return { configuredMaxW, hardwareMaxW, effectiveMaxW: Math.max(0, effectiveMaxW) };
}

export type StabilizationState = { excessSinceMs: number | null };

export function emptyStabilization(): StabilizationState {
	return { excessSinceMs: null };
}

export function stepStabilization(
	prev: StabilizationState,
	nowMs: number,
	exceedsDeadband: boolean,
	minDurationMs: number,
): { next: StabilizationState; stable: boolean; elapsedMs: number } {
	if (!exceedsDeadband) {
		return { next: { excessSinceMs: null }, stable: false, elapsedMs: 0 };
	}
	const started = prev.excessSinceMs ?? nowMs;
	const elapsedMs = Math.max(0, nowMs - started);
	const need = Math.max(0, minDurationMs);
	return {
		next: { excessSinceMs: started },
		stable: elapsedMs >= need,
		elapsedMs,
	};
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

/** Nur der reguläre GB-Setpoint (≠ 0). Der Session-Release auf 0 hängt nicht daran. */
export function gridBalanceSetpointPermit(liveTest: GridBalanceLiveTestState): boolean {
	return GRID_BALANCE_EXECUTION_ENABLED || (liveTest.armed && !liveTest.consumed);
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
	deadbandW: number;
	minDurationMs: number;
	offsetW: number;
	configuredMaxW: number;
	hardwareMaxChargeW: number | null;
	hardwareMaxDischargeW: number | null;
	minChangeW: number;
	lastWrittenW: number | null;
	ownsSetpoint: boolean;
	stabilization: StabilizationState;
	liveTest: GridBalanceLiveTestState;
	controllerIsGridBalance: boolean;
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
	priceLimitCt: number;
	priceAllowed: boolean;
	authority: GridBalanceAuthority;
	holdDetected: boolean;
	evConflict: boolean;
	explain: string;
	shouldWrite: boolean;
	shouldRelease: boolean;
	writePowerW: number;
	ownsSetpointNext: boolean;
	stabilizationNext: StabilizationState;
	liveTestNext: GridBalanceLiveTestState;
	lastAction: "written" | "released" | "blocked" | "idle" | "diagnosis_only" | "inside_deadband";
	safety: GridBalanceSafetyResult;
	evConflictKind: GridBalanceEvConflictKind;
};

function roundW(n: number): number {
	return Math.max(0, Math.round(n));
}

export function evaluateGridBalanceTick(input: GridBalanceTickInput): GridBalanceTickDecision {
	const liveTestPermit = gridBalanceSetpointPermit(input.liveTest);
	const safety = evaluateGridBalanceSafety({ ...input.safety, liveTestPermit });
	const ev = adjustConsumptionForEv({
		consumptionW: input.consumptionW,
		charging: input.charging,
		chargePowerW: input.chargePowerW,
		chargePowerAgeMs: input.chargePowerAgeMs,
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
	const stab = stepStabilization(input.stabilization, input.nowMs, exceeds, input.minDurationMs);
	const unclamped = exceeds ? roundW(rawGridDeltaW + Math.max(0, input.offsetW)) : 0;
	const requestedPowerW = Math.min(max.effectiveMaxW, unclamped);
	const minBenefitW = deadbandW;

	let blockReason = safety.blockReason;
	if (!blockReason && ev.blockReason) blockReason = ev.blockReason;
	if (!blockReason && input.forecastBlockReason) blockReason = input.forecastBlockReason;
	if (!blockReason && !exceeds) blockReason = "inside_deadband";
	if (!blockReason && max.effectiveMaxW <= 0) blockReason = "no_hardware_headroom";
	if (!blockReason && requestedPowerW < minBenefitW) blockReason = "below_min_benefit";
	if (!blockReason && !stab.stable) blockReason = "not_stable";
	if (!blockReason && !input.controllerIsGridBalance) blockReason = "controller_not_grid_balance";

	const powerEligible = blockReason === "";
	const ready = safety.policyAllowed && ev.blockReason === "" && powerEligible;
	const writeAllowed = safety.writeAllowed && powerEligible;

	let shouldWrite = false;
	let shouldRelease = false;
	let writePowerW = 0;
	let ownsNext = input.ownsSetpoint;
	let liveTestNext = input.liveTest;
	let lastAction: GridBalanceTickDecision["lastAction"] = "idle";
	let effectivePowerW = 0;

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

	if (!safety.policyAllowed || ev.blockReason || input.forecastBlockReason || !input.controllerIsGridBalance) {
		if (releasePermit) {
			shouldRelease = true;
			writePowerW = 0;
			ownsNext = false;
			lastAction = "released";
		} else {
			ownsNext = false;
			lastAction = "blocked";
			if (!safety.writeAllowed && safety.policyAllowed && !ev.blockReason) {
				lastAction = GRID_BALANCE_EXECUTION_ENABLED ? "idle" : "diagnosis_only";
			}
		}
	} else if (blockReason === "inside_deadband" || blockReason === "below_min_benefit" || blockReason === "not_stable") {
		if (releasePermit && blockReason !== "not_stable") {
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
		const delta =
			input.lastWrittenW === null ? Number.POSITIVE_INFINITY : Math.abs(requestedPowerW - input.lastWrittenW);
		if (delta >= minChange) {
			shouldWrite = true;
			writePowerW = requestedPowerW;
			effectivePowerW = requestedPowerW;
			ownsNext = true;
			lastAction = "written";
		} else {
			effectivePowerW = input.lastWrittenW ?? 0;
			lastAction = input.ownsSetpoint ? "idle" : "idle";
		}
	} else if (powerEligible && !safety.writeAllowed) {
		lastAction = input.ownsSetpoint ? "idle" : GRID_BALANCE_EXECUTION_ENABLED ? "idle" : "diagnosis_only";
		effectivePowerW = input.ownsSetpoint ? (input.lastWrittenW ?? requestedPowerW) : requestedPowerW;
	}

	const explain = formatGridBalanceExplain({
		enabled: safety.enabled,
		blockReason,
		priceNowCt: input.safety.priceNowCt,
		priceLimitCt: input.safety.priceLimitCt,
		gridImportW: rawGridDeltaW,
	});

	return {
		enabled: safety.enabled,
		active: shouldWrite || (input.ownsSetpoint && lastAction !== "released" && lastAction !== "blocked"),
		ready,
		blockReason,
		currentPriceCt: input.safety.priceNowCt,
		priceLimitCt: input.safety.priceLimitCt,
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
		writePowerW,
		ownsSetpointNext: ownsNext,
		stabilizationNext: stab.next,
		liveTestNext,
		lastAction,
		safety,
		evConflictKind: input.safety.evConflictKind,
	};
}
