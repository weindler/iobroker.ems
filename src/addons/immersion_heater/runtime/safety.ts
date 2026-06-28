import type { ImmersionDeviceConfig, ImmersionFaultCode } from "./types";

export interface PowerCheckInput {
	nowMs: number;
	/** Nur im Live-Modus besitzt EMS das Relais — im Dryrun nie ein Power-Fault. */
	executionLive: boolean;
	commandedOn: boolean;
	commandedStage: number;
	nominalPowerW: number;
	measuredPowerW: number | null;
	hasPowerMeasurement: boolean;
	/** Stufe meldet laut Rückmeldung Betrieb (für power_when_off auch ohne Messung). */
	feedbackActive: boolean;
	/** Zeitpunkt, zu dem EMS selbst EIN geschrieben hat (Live). */
	emsOnWriteAtMs: number | null;
	/** Zeitpunkt, zu dem EMS selbst AUS geschrieben hat (Live). */
	emsOffWriteAtMs: number | null;
	mismatchSinceMs: number | null;
	config: ImmersionDeviceConfig;
}

export interface PowerCheckResult {
	faultCode: ImmersionFaultCode;
	faultMessage: string;
	mismatchSinceMs: number | null;
	lockout: boolean;
}

export function checkPowerFault(input: PowerCheckInput): PowerCheckResult {
	const none: PowerCheckResult = { faultCode: "none", faultMessage: "", mismatchSinceMs: input.mismatchSinceMs, lockout: false };

	// Dryrun: EMS besitzt das Relais nicht → keine Power-/Feedback-Faults.
	if (!input.executionLive) {
		return { ...none, mismatchSinceMs: null };
	}

	const { config, nowMs, commandedOn, measuredPowerW, nominalPowerW } = input;
	const hasMeasurement = input.hasPowerMeasurement && measuredPowerW !== null;

	if (!commandedOn) {
		// power_when_off erst, nachdem EMS selbst AUS geschrieben hat und die Prüfverzögerung abgelaufen ist.
		if (input.emsOffWriteAtMs === null) {
			return { ...none, mismatchSinceMs: null };
		}
		const delayMs = config.switchOffCheckDelaySec * 1000;
		if (nowMs - input.emsOffWriteAtMs < delayMs) {
			return { ...none, mismatchSinceMs: null };
		}
		const powerStillOn = hasMeasurement && (measuredPowerW as number) > config.powerOffThresholdW;
		if (powerStillOn || input.feedbackActive) {
			const detail = powerStillOn
				? `${measuredPowerW}W > ${config.powerOffThresholdW}W`
				: "feedback still active";
			return {
				faultCode: "power_when_off",
				faultMessage: `power_when_off: ${detail}`,
				mismatchSinceMs: null,
				lockout: true,
			};
		}
		return { ...none, mismatchSinceMs: null };
	}

	if (input.commandedStage <= 0) {
		return { ...none, mismatchSinceMs: null };
	}

	// no_power_when_on / mismatch brauchen eine Messung und einen EMS-EIN-Write + Verzögerung.
	if (!hasMeasurement || input.emsOnWriteAtMs === null) {
		return { ...none, mismatchSinceMs: null };
	}
	const delayMs = config.switchOnCheckDelaySec * 1000;
	if (nowMs - input.emsOnWriteAtMs < delayMs) {
		return { ...none, mismatchSinceMs: null };
	}

	const measured = measuredPowerW as number;
	if (measured < config.powerOnThresholdW) {
		return {
			faultCode: "no_power_when_on",
			faultMessage: `no_power_when_on: ${measured}W < ${config.powerOnThresholdW}W`,
			mismatchSinceMs: null,
			lockout: true,
		};
	}

	if (nominalPowerW > 0) {
		const tol = config.powerTolerancePct / 100;
		const low = nominalPowerW * (1 - tol);
		const high = nominalPowerW * (1 + tol);
		if (measured < low || measured > high) {
			const since = input.mismatchSinceMs ?? nowMs;
			if (nowMs - since >= config.powerMismatchDurationSec * 1000) {
				return {
					faultCode: "power_mismatch",
					faultMessage: `power_mismatch: ${measured}W vs nominal ${nominalPowerW}W`,
					mismatchSinceMs: since,
					lockout: true,
				};
			}
			return { faultCode: "none", faultMessage: "", mismatchSinceMs: since, lockout: false };
		}
	}

	return { ...none, mismatchSinceMs: null };
}

export interface ChatterTracker {
	timestampsMs: number[];
}

export function recordChatterEvent(tracker: ChatterTracker, nowMs: number, windowSec: number): ChatterTracker {
	const windowMs = windowSec * 1000;
	const kept = tracker.timestampsMs.filter((t) => nowMs - t <= windowMs);
	return { timestampsMs: [...kept, nowMs] };
}

export function isRelayChatter(tracker: ChatterTracker, maxChanges: number): boolean {
	return tracker.timestampsMs.length > maxChanges;
}

export function canResetFault(input: {
	allStagesOff: boolean;
	measuredPowerW: number | null;
	hasPowerMeasurement: boolean;
	powerOffThresholdW: number;
	configValid: boolean;
	temperatureValid: boolean;
	chatterActive: boolean;
}): { ok: boolean; reason: string } {
	if (!input.configValid) return { ok: false, reason: "invalid_config" };
	if (!input.temperatureValid) return { ok: false, reason: "temperature_invalid" };
	if (!input.allStagesOff) return { ok: false, reason: "stages_not_off" };
	if (input.chatterActive) return { ok: false, reason: "relay_chatter_active" };
	if (input.hasPowerMeasurement && input.measuredPowerW !== null && input.measuredPowerW > input.powerOffThresholdW) {
		return { ok: false, reason: "power_still_present" };
	}
	return { ok: true, reason: "reset_ok" };
}
