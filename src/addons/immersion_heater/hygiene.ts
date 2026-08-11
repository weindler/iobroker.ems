/**
 * Wöchentliche Legionellen-/Hygiene-Pflicht — Nachweis ausschließlich Boiler-Temperatur.
 * Puffer-Max bleibt absolute physische Grenze (kein Endlos-Heizen).
 */

export const DEFAULT_HYGIENE_TARGET_C = 60;
export const DEFAULT_HYGIENE_INTERVAL_MS = 7 * 24 * 3600_000;

export type HygienePersist = {
	/** ISO Zeitpunkt, zu dem Boiler zuletzt ≥ hygieneTarget war. */
	lastBoilerHygieneAtIso: string | null;
};

export function emptyHygienePersist(): HygienePersist {
	return { lastBoilerHygieneAtIso: null };
}

export function recordBoilerHygieneIfMet(input: {
	boilerTempC: number | null;
	hygieneTargetTempC: number;
	nowIso: string;
	persist: HygienePersist;
}): HygienePersist {
	if (input.boilerTempC != null && input.boilerTempC >= input.hygieneTargetTempC) {
		return { lastBoilerHygieneAtIso: input.nowIso };
	}
	return input.persist;
}

export function evaluateHygieneDuty(input: {
	nowMs: number;
	boilerTempC: number | null;
	hygieneTargetTempC: number;
	bufferTempC: number | null;
	bufferMaxTempC: number | null;
	lastBoilerHygieneAtIso: string | null;
	intervalMs?: number;
	kwhPerDegreeC: number;
}): {
	due: boolean;
	mandatoryEnergyKwh: number;
	blockedByBufferMax: boolean;
	reasonDe: string;
	deadlineMs: number | null;
} {
	const interval = input.intervalMs ?? DEFAULT_HYGIENE_INTERVAL_MS;
	const lastMs = input.lastBoilerHygieneAtIso ? Date.parse(input.lastBoilerHygieneAtIso) : Number.NaN;
	const ever = Number.isFinite(lastMs);
	const due = !ever || input.nowMs - lastMs >= interval;
	const deadlineMs = ever ? lastMs + interval : input.nowMs; // sofort wenn nie erfüllt

	if (!due) {
		return {
			due: false,
			mandatoryEnergyKwh: 0,
			blockedByBufferMax: false,
			reasonDe: "Hygiene innerhalb 7 Tage erfüllt.",
			deadlineMs: lastMs + interval,
		};
	}

	if (input.boilerTempC != null && input.boilerTempC >= input.hygieneTargetTempC) {
		return {
			due: false,
			mandatoryEnergyKwh: 0,
			blockedByBufferMax: false,
			reasonDe: "Boiler bereits ≥ Hygiene-Ziel.",
			deadlineMs,
		};
	}

	const bufferAtMax =
		input.bufferTempC != null &&
		input.bufferMaxTempC != null &&
		input.bufferTempC >= input.bufferMaxTempC - 0.05;

	if (bufferAtMax) {
		return {
			due: true,
			mandatoryEnergyKwh: 0,
			blockedByBufferMax: true,
			reasonDe:
				"Hygiene fällig, aber Puffer bereits am Maximum — Heizstab blockiert; alternative Wärmequelle nötig.",
			deadlineMs,
		};
	}

	const boiler = input.boilerTempC;
	const needK =
		boiler != null && Number.isFinite(boiler)
			? Math.max(0, input.hygieneTargetTempC - boiler)
			: Math.max(0, input.hygieneTargetTempC - 40); // ohne Sensor: Diagnose, keine Fake-Deadline-Energie aus Puffer
	const energy =
		boiler == null
			? 0
			: Math.round(needK * input.kwhPerDegreeC * 1000) / 1000;

	return {
		due: true,
		mandatoryEnergyKwh: energy,
		blockedByBufferMax: false,
		reasonDe:
			boiler == null
				? "Hygiene fällig — Boiler-Sensor fehlt, keine erfundene Hard-Energie."
				: `Hygiene fällig — Boiler auf >${input.hygieneTargetTempC} °C bringen.`,
		deadlineMs,
	};
}
