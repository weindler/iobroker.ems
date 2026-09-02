/**
 * Stabilitätsfilter nur fürs Learning — die GB-Regelung bleibt unverändert unmittelbar.
 * Relativ + Mindesttoleranz, keine starre Wattgrenze für alle Betriebspunkte.
 */

import {
	STABILITY_ABS_FLOOR_GB_W,
	STABILITY_ABS_FLOOR_GRID_W,
	STABILITY_ABS_FLOOR_HOUSE_W,
	STABILITY_ABS_FLOOR_PV_W,
	STABILITY_MIN_SAMPLES,
	STABILITY_REL_TOL,
} from "./constants";

export type StabilitySample = {
	houseW: number | null;
	pvW: number | null;
	gridW: number | null;
	gbEffectiveW: number | null;
};

function finiteOrNull(v: number | null | undefined): number | null {
	return v != null && Number.isFinite(v) ? v : null;
}

function seriesStable(values: number[], absFloor: number, relTol: number): boolean {
	if (values.length < STABILITY_MIN_SAMPLES) return false;
	const min = Math.min(...values);
	const max = Math.max(...values);
	const range = max - min;
	const mid = values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
	const scale = Math.max(Math.abs(mid), absFloor);
	return range <= Math.max(absFloor, relTol * scale);
}

/**
 * True, wenn alle vorhandenen relevanten Größen im Fenster ausreichend ruhig sind.
 * Fehlende Größen werden nicht als 0 erfunden — sie zählen nicht gegen Stabilität,
 * aber ohne Hauslast + GB (bzw. Grid) ist das Fenster nicht lernfähig.
 */
export function isStabilityWindowStable(
	samples: StabilitySample[],
	opts?: { minSamples?: number; relTol?: number },
): boolean {
	const minSamples = opts?.minSamples ?? STABILITY_MIN_SAMPLES;
	const relTol = opts?.relTol ?? STABILITY_REL_TOL;
	if (samples.length < minSamples) return false;
	const window = samples.slice(-minSamples);

	const house = window.map((s) => finiteOrNull(s.houseW)).filter((v): v is number => v != null);
	const pv = window.map((s) => finiteOrNull(s.pvW)).filter((v): v is number => v != null);
	const grid = window.map((s) => finiteOrNull(s.gridW)).filter((v): v is number => v != null);
	const gb = window.map((s) => finiteOrNull(s.gbEffectiveW)).filter((v): v is number => v != null);

	if (house.length < minSamples) return false;
	if (!seriesStable(house, STABILITY_ABS_FLOOR_HOUSE_W, relTol)) return false;

	if (pv.length >= minSamples && !seriesStable(pv, STABILITY_ABS_FLOOR_PV_W, relTol)) return false;
	if (grid.length >= minSamples && !seriesStable(grid, STABILITY_ABS_FLOOR_GRID_W, relTol)) return false;
	if (gb.length >= minSamples && !seriesStable(gb, STABILITY_ABS_FLOOR_GB_W, relTol)) return false;

	return true;
}

export function pushStabilitySample<T>(buf: T[], sample: T, max: number): T[] {
	const next = buf.length >= max ? buf.slice(buf.length - max + 1) : buf.slice();
	next.push(sample);
	return next;
}
