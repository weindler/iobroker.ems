/**
 * PHASE 5 — Shadow-Lastmodell.
 *
 * Die Shadow-Welt darf NICHT die reale Gesamt-Hauslast übernehmen und anschließend
 * steuerbare Verbraucher noch einmal drauflegen (Doppelzählung).
 *
 *   exogene Grundlast = reale Hauslast − reale steuerbare EMS-Verbraucher
 *   Weltlast          = exogene Grundlast + steuerbare Verbraucher DIESER Welt
 *
 * Steuerbar (EMS): Klima (Shared-Power, nie Indoor-Doppelt), Heizstab, EV.
 * Measured Consumers ohne EMS-Steuerung bleiben in der exogenen Last.
 *
 * Fehlende Komponenten werden nicht als 0 erfunden — sie werden nicht abgezogen.
 * Wenn die Summe der bekannten Steuerbaren die Hauslast übersteigt (Messinkonsistenz),
 * wird die exogene Last auf 0 geklemmt statt negativ zu werden.
 */

import type { DayTelemetryDayRecord } from "../day_telemetry/types";

export type ShadowLoadSplit = {
	/** Hauslast ohne steuerbare EMS-Verbraucher. null = Slot ohne Hauslast. */
	exogenousKwh: Array<number | null>;
	/** Summe der in diesem Slot bekannten steuerbaren EMS-Verbraucher. */
	controllableKwh: Array<number | null>;
	/**
	 * Last, die die reference_no_ems-Batteriesimulation sieht:
	 * exogen + reale Steuerbare (kein alternatives Zeitmodell für Klima/Heizstab/EV).
	 * Identisch zur Hauslast, sobald alle Steuerbaren bekannt und ≤ Haus sind —
	 * niemals Haus + extra Steuerbare.
	 */
	noEmsTotalLoadKwh: Array<number | null>;
};

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function slotControllableKwh(day: DayTelemetryDayRecord, i: number): number | null {
	const climateShared = day.buckets.climateElecSharedKwh[i];
	const climateFallback = day.buckets.climateKwh[i];
	const climate = climateShared !== null ? climateShared : climateFallback;
	const immersion = day.buckets.immersionKwh[i];
	const ev = day.buckets.evChargedKwh[i];
	let sum = 0;
	let any = false;
	for (const v of [climate, immersion, ev]) {
		if (v === null || !Number.isFinite(v) || v < 0) continue;
		sum += v;
		any = true;
	}
	return any ? round3(sum) : null;
}

/**
 * Spaltet die reale Hauslast in exogene Grundlast und steuerbare EMS-Verbraucher.
 * Rein deterministisch, keine I/O, keine Future-Leakage (nur day_telemetry-Buckets).
 */
export function splitExogenousLoad(day: DayTelemetryDayRecord): ShadowLoadSplit {
	const n = day.slotCount;
	const exogenousKwh: Array<number | null> = new Array(n).fill(null);
	const controllableKwh: Array<number | null> = new Array(n).fill(null);
	const noEmsTotalLoadKwh: Array<number | null> = new Array(n).fill(null);

	for (let i = 0; i < n; i++) {
		const house = day.buckets.houseTotalKwh[i];
		const ctrl = slotControllableKwh(day, i);
		controllableKwh[i] = ctrl;
		if (house === null || !Number.isFinite(house) || house < 0) continue;
		const exo = ctrl === null ? house : Math.max(0, house - ctrl);
		exogenousKwh[i] = round3(exo);
		/*
		 * reference_no_ems: kein belastbares alternatives Zeitmodell für Klima/Heizstab/EV
		 * → reale Steuerbare wieder addieren. Ergebnis = Hauslast (geclampt), nie Haus+extra.
		 */
		noEmsTotalLoadKwh[i] = round3(exo + (ctrl ?? 0));
	}

	return { exogenousKwh, controllableKwh, noEmsTotalLoadKwh };
}
