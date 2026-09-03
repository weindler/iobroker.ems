/**
 * Climate Run Segments — Segmentbildung bei Mode/Unit/Group/Validity-Wechsel.
 * Idle (Climate AUS) wird als eigenes Segment mit mode=off / valid=false gehalten,
 * damit passive Raumdynamik rekonstruierbar ist. Elektrisches Shared-Power-Learning
 * überspringt diese Segmente weiterhin (valid=false, combo none).
 */

import type { ClimateRunSegment, ClimateUnitThermalObservation } from "./types";

export type ClimateSegmentKey = {
	/** null = unknown — niemals "default" erfinden. */
	sharedPowerGroupId: string | null;
	mode: string;
	activeUnitCombination: string;
	valid: boolean;
};

export type ClimateSegmentThermalSnap = {
	outdoorTempC: number | null;
	units: Array<{
		unitIndex: number;
		roomTempC: number | null;
		roomHumidityPct: number | null;
		ownershipOwner: string | null;
		overrideActive: boolean | null;
	}>;
};

export type OpenClimateSegment = ClimateSegmentKey & {
	startTs: number;
	energyKwh: number;
	runtimeSec: number;
	rejectReason: string | null;
	outdoorTempStartC: number | null;
	outdoorTempEndC: number | null;
	unitThermal: ClimateUnitThermalObservation[];
	ownershipOwner: string | null;
	overrideActive: boolean | null;
};

function keyEqual(a: ClimateSegmentKey, b: ClimateSegmentKey): boolean {
	return (
		a.sharedPowerGroupId === b.sharedPowerGroupId &&
		a.mode === b.mode &&
		a.activeUnitCombination === b.activeUnitCombination &&
		a.valid === b.valid
	);
}

function emptyOpenThermal(): Pick<
	OpenClimateSegment,
	"outdoorTempStartC" | "outdoorTempEndC" | "unitThermal" | "ownershipOwner" | "overrideActive"
> {
	return {
		outdoorTempStartC: null,
		outdoorTempEndC: null,
		unitThermal: [],
		ownershipOwner: null,
		overrideActive: null,
	};
}

function applySnapStart(snap: ClimateSegmentThermalSnap | undefined): ReturnType<typeof emptyOpenThermal> {
	const base = emptyOpenThermal();
	if (!snap) return base;
	base.outdoorTempStartC = snap.outdoorTempC;
	base.outdoorTempEndC = snap.outdoorTempC;
	base.unitThermal = snap.units.map((u) => ({
		unitIndex: u.unitIndex,
		roomTempStartC: u.roomTempC,
		roomTempEndC: u.roomTempC,
		roomHumidityStartPct: u.roomHumidityPct,
		roomHumidityEndPct: u.roomHumidityPct,
		ownershipOwner: u.ownershipOwner,
		overrideActive: u.overrideActive,
	}));
	const owners = snap.units.map((u) => u.ownershipOwner).filter((o): o is string => !!o);
	base.ownershipOwner = owners[0] ?? null;
	const overrides = snap.units.map((u) => u.overrideActive).filter((o): o is boolean => o != null);
	base.overrideActive = overrides.some((v) => v === true) ? true : overrides.length ? false : null;
	return base;
}

function applySnapEnd(open: OpenClimateSegment, snap: ClimateSegmentThermalSnap | undefined): void {
	if (!snap) return;
	if (snap.outdoorTempC != null) open.outdoorTempEndC = snap.outdoorTempC;
	for (const u of snap.units) {
		let obs = open.unitThermal.find((o) => o.unitIndex === u.unitIndex);
		if (!obs) {
			obs = {
				unitIndex: u.unitIndex,
				roomTempStartC: null,
				roomTempEndC: null,
				roomHumidityStartPct: null,
				roomHumidityEndPct: null,
				ownershipOwner: u.ownershipOwner,
				overrideActive: u.overrideActive,
			};
			open.unitThermal.push(obs);
		}
		if (u.roomTempC != null) obs.roomTempEndC = u.roomTempC;
		if (u.roomHumidityPct != null) obs.roomHumidityEndPct = u.roomHumidityPct;
		if (u.ownershipOwner != null) obs.ownershipOwner = u.ownershipOwner;
		if (u.overrideActive != null) obs.overrideActive = u.overrideActive;
	}
	const owners = open.unitThermal.map((o) => o.ownershipOwner).filter((o): o is string => !!o);
	if (owners.length) open.ownershipOwner = owners[0] ?? null;
	const overrides = open.unitThermal.map((o) => o.overrideActive).filter((o): o is boolean => o != null);
	if (overrides.length) open.overrideActive = overrides.some((v) => v === true);
}

function thermalQuality(open: OpenClimateSegment): { usable: boolean; reason: string | null } {
	const complete = open.unitThermal.some(
		(o) => o.roomTempStartC != null && o.roomTempEndC != null,
	);
	if (!complete) return { usable: false, reason: "missing_room_temp" };
	return { usable: true, reason: null };
}

function toClosedSegment(open: OpenClimateSegment, endTs: number): ClimateRunSegment {
	const thermal = thermalQuality(open);
	return {
		startTs: open.startTs,
		endTs,
		sharedPowerGroupId: open.sharedPowerGroupId,
		mode: open.mode,
		activeUnitCombination: open.activeUnitCombination,
		energyKwh: open.energyKwh,
		runtimeSec: open.runtimeSec,
		valid: open.valid,
		rejectReason: open.rejectReason,
		outdoorTempStartC: open.outdoorTempStartC,
		outdoorTempEndC: open.outdoorTempEndC,
		unitObservations: open.unitThermal.map((o) => ({ ...o })),
		ownershipOwner: open.ownershipOwner,
		overrideActive: open.overrideActive,
		thermalUsable: thermal.usable,
		thermalRejectReason: thermal.reason,
	};
}

function openFromKey(
	key: ClimateSegmentKey,
	nowTs: number,
	deltaKwh: number,
	deltaRuntimeSec: number,
	rejectReason: string | null,
	snap: ClimateSegmentThermalSnap | undefined,
): OpenClimateSegment {
	return {
		...key,
		startTs: nowTs,
		energyKwh: Math.max(0, deltaKwh),
		runtimeSec: Math.max(0, deltaRuntimeSec),
		rejectReason,
		...applySnapStart(snap),
	};
}

/** Schließt offenes Segment und hängt es an die Liste. */
export function closeClimateSegment(
	open: OpenClimateSegment | null,
	endTs: number,
	list: ClimateRunSegment[],
): ClimateRunSegment[] {
	if (!open || endTs <= open.startTs) return list;
	return [...list, toClosedSegment(open, endTs)];
}

/**
 * Aktualisiert laufendes Segment mit Messprobe.
 * Bei Key-Wechsel: altes schließen, neues öffnen.
 * Idle (`combo === "none"`) bleibt als mode=off-Segment offen — keine Schätzung fehlender Werte.
 */
export function advanceClimateSegment(
	open: OpenClimateSegment | null,
	nowTs: number,
	key: ClimateSegmentKey,
	deltaKwh: number,
	deltaRuntimeSec: number,
	rejectReason: string | null,
	list: ClimateRunSegment[],
	thermalSnap?: ClimateSegmentThermalSnap,
): { open: OpenClimateSegment | null; list: ClimateRunSegment[] } {
	if (!open) {
		return {
			open: openFromKey(key, nowTs, deltaKwh, deltaRuntimeSec, rejectReason, thermalSnap),
			list,
		};
	}

	if (!keyEqual(open, key)) {
		const closed = closeClimateSegment(open, nowTs, list);
		return {
			open: openFromKey(key, nowTs, deltaKwh, deltaRuntimeSec, rejectReason, thermalSnap),
			list: closed,
		};
	}

	const next: OpenClimateSegment = {
		...open,
		energyKwh: open.energyKwh + Math.max(0, deltaKwh),
		runtimeSec: open.runtimeSec + Math.max(0, deltaRuntimeSec),
		rejectReason: rejectReason ?? open.rejectReason,
		unitThermal: open.unitThermal.map((o) => ({ ...o })),
	};
	applySnapEnd(next, thermalSnap);
	return { open: next, list };
}
