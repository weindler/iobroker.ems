/**
 * Immersion (Heizstab) Run Segments — additiv, analog Climate Run Segments.
 * Segmentgrenze = on/off-Wechsel (immersionRuntimeOn). Kontext-Felder (decisionSource,
 * forcedMode, hygieneStatusDe, ownershipOwner) sind Live-Mirror bereits vorhandener
 * Runtime-States zum Startzeitpunkt des Segments — kein Recompute, keine rückwirkende
 * Rekonstruktion aus heutigem State.
 */

import type { ImmersionRunSegment } from "./types";

export type ImmersionSegmentContext = {
	decisionSource: string | null;
	forcedMode: boolean | null;
	hygieneStatusDe: string | null;
	ownershipOwner: string | null;
};

export type OpenImmersionSegment = ImmersionSegmentContext & {
	startTs: number;
	energyKwh: number;
	runtimeSec: number;
};

/** Schließt offenes Segment und hängt es an die Liste. */
export function closeImmersionSegment(
	open: OpenImmersionSegment | null,
	endTs: number,
	list: ImmersionRunSegment[],
): ImmersionRunSegment[] {
	if (!open || endTs <= open.startTs || !(open.runtimeSec > 0)) return list;
	return [
		...list,
		{
			startTs: open.startTs,
			endTs,
			energyKwh: open.energyKwh,
			runtimeSec: open.runtimeSec,
			valid: true,
			rejectReason: null,
			decisionSource: open.decisionSource,
			forcedMode: open.forcedMode,
			hygieneStatusDe: open.hygieneStatusDe,
			ownershipOwner: open.ownershipOwner,
		},
	];
}

/**
 * Aktualisiert laufendes Segment mit Messprobe.
 * Bei on→off: Segment schließen. Bei off→on: neues Segment öffnen (Kontext bei Start einfrieren).
 * Kontext wird während eines laufenden Segments NICHT nachträglich überschrieben — er
 * repräsentiert die Lage zum Startzeitpunkt des Laufs.
 */
export function advanceImmersionSegment(
	open: OpenImmersionSegment | null,
	nowTs: number,
	on: boolean,
	deltaKwh: number,
	deltaRuntimeSec: number,
	context: ImmersionSegmentContext,
	list: ImmersionRunSegment[],
): { open: OpenImmersionSegment | null; list: ImmersionRunSegment[] } {
	if (!on) {
		return { open: null, list: closeImmersionSegment(open, nowTs, list) };
	}
	if (!open) {
		return {
			open: {
				...context,
				startTs: nowTs,
				energyKwh: Math.max(0, deltaKwh),
				runtimeSec: Math.max(0, deltaRuntimeSec),
			},
			list,
		};
	}
	return {
		open: {
			...open,
			energyKwh: open.energyKwh + Math.max(0, deltaKwh),
			runtimeSec: open.runtimeSec + Math.max(0, deltaRuntimeSec),
		},
		list,
	};
}
