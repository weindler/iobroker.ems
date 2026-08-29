/**
 * Climate Run Segments — Segmentbildung bei Mode/Unit/Group/Validity-Wechsel.
 */

import type { ClimateRunSegment } from "./types";

export type ClimateSegmentKey = {
	/** null = unknown — niemals "default" erfinden. */
	sharedPowerGroupId: string | null;
	mode: string;
	activeUnitCombination: string;
	valid: boolean;
};

export type OpenClimateSegment = ClimateSegmentKey & {
	startTs: number;
	energyKwh: number;
	runtimeSec: number;
	rejectReason: string | null;
};

function keyEqual(a: ClimateSegmentKey, b: ClimateSegmentKey): boolean {
	return (
		a.sharedPowerGroupId === b.sharedPowerGroupId &&
		a.mode === b.mode &&
		a.activeUnitCombination === b.activeUnitCombination &&
		a.valid === b.valid
	);
}

/** Schließt offenes Segment und hängt es an die Liste. */
export function closeClimateSegment(
	open: OpenClimateSegment | null,
	endTs: number,
	list: ClimateRunSegment[],
): ClimateRunSegment[] {
	if (!open || endTs <= open.startTs) return list;
	return [
		...list,
		{
			startTs: open.startTs,
			endTs,
			sharedPowerGroupId: open.sharedPowerGroupId,
			mode: open.mode,
			activeUnitCombination: open.activeUnitCombination,
			energyKwh: open.energyKwh,
			runtimeSec: open.runtimeSec,
			valid: open.valid,
			rejectReason: open.rejectReason,
		},
	];
}

/**
 * Aktualisiert laufendes Segment mit Messprobe.
 * Bei Key-Wechsel: altes schließen, neues öffnen.
 */
export function advanceClimateSegment(
	open: OpenClimateSegment | null,
	nowTs: number,
	key: ClimateSegmentKey,
	deltaKwh: number,
	deltaRuntimeSec: number,
	rejectReason: string | null,
	list: ClimateRunSegment[],
): { open: OpenClimateSegment | null; list: ClimateRunSegment[] } {
	if (key.activeUnitCombination === "none" || !key.activeUnitCombination) {
		/* idle — laufendes Segment schließen */
		return { open: null, list: closeClimateSegment(open, nowTs, list) };
	}

	if (!open) {
		return {
			open: {
				...key,
				startTs: nowTs,
				energyKwh: Math.max(0, deltaKwh),
				runtimeSec: Math.max(0, deltaRuntimeSec),
				rejectReason,
			},
			list,
		};
	}

	if (!keyEqual(open, key)) {
		const closed = closeClimateSegment(open, nowTs, list);
		return {
			open: {
				...key,
				startTs: nowTs,
				energyKwh: Math.max(0, deltaKwh),
				runtimeSec: Math.max(0, deltaRuntimeSec),
				rejectReason,
			},
			list: closed,
		};
	}

	return {
		open: {
			...open,
			energyKwh: open.energyKwh + Math.max(0, deltaKwh),
			runtimeSec: open.runtimeSec + Math.max(0, deltaRuntimeSec),
			rejectReason: rejectReason ?? open.rejectReason,
		},
		list,
	};
}
