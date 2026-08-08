/**
 * Konsistente NOW-Slot-Bilanz: Live-PV und Live-Hauslast aus derselben Realwelt.
 * Zukunftsslots bleiben Forecast-only — kein Live-Floor mehr.
 */

import { computePvSurplusW } from "../planning/surplus";
import type { DailyPlanSlot } from "./types";
import { operatorQuality } from "../quality";

/** Max. Alter Live-Telemetrie für NOW-Bilanz (Sekunden). */
export const LIVE_NOW_MAX_AGE_SEC = 120;

export type LiveNowTelemetry = {
	pvPowerW: number | null;
	houseLoadW: number | null;
	/** Alter der PV-Messung; null = unbekannt (nur Wert prüfen). */
	pvAgeSec?: number | null;
	houseAgeSec?: number | null;
	maxAgeSec?: number;
};

export function isPlausibleLivePowerW(powerW: number | null | undefined): powerW is number {
	return powerW != null && Number.isFinite(powerW) && powerW >= 0 && powerW <= 100_000;
}

/** Live nur nutzbar wenn PV+HL gültig, plausibel und (falls bekannt) frisch. */
export function isLiveNowTelemetryUsable(input: LiveNowTelemetry): boolean {
	if (!isPlausibleLivePowerW(input.pvPowerW) || !isPlausibleLivePowerW(input.houseLoadW)) {
		return false;
	}
	const maxAge = input.maxAgeSec ?? LIVE_NOW_MAX_AGE_SEC;
	if (input.pvAgeSec != null && Number.isFinite(input.pvAgeSec) && input.pvAgeSec > maxAge) {
		return false;
	}
	if (input.houseAgeSec != null && Number.isFinite(input.houseAgeSec) && input.houseAgeSec > maxAge) {
		return false;
	}
	return true;
}

export type NowBalanceW = {
	pvPowerW: number;
	houseLoadPowerW: number;
	fixedBalancePowerW: number;
	availablePvSurplusPowerW: number;
};

export function computeLiveNowBalanceW(pvPowerW: number, houseLoadW: number): NowBalanceW {
	const pv = Math.round(pvPowerW);
	const house = Math.round(houseLoadW);
	const balance = pv - house;
	const surplus = computePvSurplusW(pv, house) ?? 0;
	return {
		pvPowerW: pv,
		houseLoadPowerW: house,
		fixedBalancePowerW: balance,
		availablePvSurplusPowerW: surplus,
	};
}

/**
 * Schreibt die konsistente Live-Bilanz in den aktuellen Slot.
 * Mutiert `slots` in-place. Zukunftsslots bleiben unverändert.
 * @returns true wenn NOW auf Live gesetzt wurde.
 */
export function applyLiveNowBalanceToCurrentSlot(
	slots: DailyPlanSlot[],
	nowMs: number,
	live: LiveNowTelemetry,
): boolean {
	if (!isLiveNowTelemetryUsable(live)) return false;
	const bal = computeLiveNowBalanceW(live.pvPowerW!, live.houseLoadW!);
	for (const slot of slots) {
		const start = Date.parse(slot.slot.startIso);
		const end = Date.parse(slot.slot.endIso);
		if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
		if (nowMs < start || nowMs >= end) continue;
		slot.pvForecastPowerW = bal.pvPowerW;
		slot.fixedHouseLoadPowerW = bal.houseLoadPowerW;
		slot.fixedBalancePowerW = bal.fixedBalancePowerW;
		slot.availablePvSurplusPowerW = bal.availablePvSurplusPowerW;
		slot.remainingPvSurplusPowerW = bal.availablePvSurplusPowerW;
		slot.quality = operatorQuality("valid", "NOW-Slot: Live-PV und Live-Hauslast (konsistent).");
		slot.reasonDe = "NOW live-live Bilanz.";
		return true;
	}
	return false;
}

/**
 * Invariant: Slot ist entweder live-live oder forecast-forecast — nie gemischt.
 * Prüft: availablePvSurplus ≈ max(0, pv − house) wenn beide Komponenten gesetzt.
 */
export function slotBalanceIsConsistent(slot: {
	pvForecastPowerW: number | null;
	fixedHouseLoadPowerW: number | null;
	fixedBalancePowerW: number | null;
	availablePvSurplusPowerW: number | null;
}): boolean {
	const pv = slot.pvForecastPowerW;
	const house = slot.fixedHouseLoadPowerW;
	const bal = slot.fixedBalancePowerW;
	const avail = slot.availablePvSurplusPowerW;
	if (pv === null || house === null) {
		return bal === null && avail === null;
	}
	const expectBal = pv - house;
	const expectAvail = Math.max(0, expectBal);
	if (bal === null || avail === null) return false;
	return Math.abs(bal - expectBal) <= 1 && Math.abs(avail - expectAvail) <= 1;
}

/**
 * @deprecated Beta-Befund 002: ersetzt durch applyLiveNowBalanceToCurrentSlot.
 * Behält Signatur für Übergangs-Imports — wendet keinen Forecast/Live-Mix mehr an.
 */
export function applyLiveSurplusFloorToCurrentSlot(
	slots: DailyPlanSlot[],
	nowMs: number,
	liveSurplusW: number | null,
): void {
	void liveSurplusW;
	void slots;
	void nowMs;
	// no-op: Mix-Floor entfernt — Aufrufer müssen applyLiveNowBalanceToCurrentSlot nutzen.
}
