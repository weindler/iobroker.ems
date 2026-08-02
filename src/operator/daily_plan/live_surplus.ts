import { computeDeficitW } from "../planning/battery";
import { computePvSurplusW } from "../planning/surplus";
import type { DailyPlanSlot } from "./types";
import { slotStartIsoFloored } from "./slots";

/**
 * Roadmap Block 3.3: Live-PV-Überschuss/-Defizit für Diagnose/VIS kommt ab hier direkt aus dem
 * Live-Cache (`live.pv.power_w` / `live.battery.pv_ac_power_w` / `live.battery.house_load_w`,
 * dieselben Quellen, die zuvor nur der alte Realtime-Planner für `planner.surplus_w` /
 * `planner.deficit_w` gelesen hat) statt aus dessen Tick — kontextualisiert mit dem aktuellen
 * Daily-Plan-Slot (`slotStartIso`). Reine Anzeige/Diagnose, keine Steuerentscheidung.
 */
export interface OperatorLiveSurplusResult {
	pvPowerW: number | null;
	houseLoadW: number | null;
	surplusW: number | null;
	deficitW: number | null;
	slotStartIso: string | null;
	status: "valid" | "missing";
}

export function buildOperatorLiveSurplus(input: {
	pvPowerW: number | null;
	houseLoadW: number | null;
	now: Date;
	timezone: string;
}): OperatorLiveSurplusResult {
	const { pvPowerW, houseLoadW, now, timezone } = input;
	const slotStartIso = slotStartIsoFloored(now, timezone);
	return {
		pvPowerW,
		houseLoadW,
		surplusW: computePvSurplusW(pvPowerW, houseLoadW),
		deficitW: computeDeficitW(pvPowerW, houseLoadW),
		slotStartIso: slotStartIso || null,
		status: pvPowerW !== null && houseLoadW !== null ? "valid" : "missing",
	};
}

/**
 * Hebt den aktuellen Horizont-Slot auf den Live-PV-Überschuss an, wenn der Forecast zu niedrig
 * liegt (morgens oft). Nur Floor nach oben — nie Forecast absenken. Mutiert `slots` in-place.
 */
export function applyLiveSurplusFloorToCurrentSlot(
	slots: DailyPlanSlot[],
	nowMs: number,
	liveSurplusW: number | null,
): void {
	if (liveSurplusW === null || !Number.isFinite(liveSurplusW) || liveSurplusW <= 0) return;
	const floor = Math.round(liveSurplusW);
	for (const slot of slots) {
		const start = Date.parse(slot.slot.startIso);
		const end = Date.parse(slot.slot.endIso);
		if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
		if (nowMs < start || nowMs >= end) continue;
		const forecast = slot.availablePvSurplusPowerW;
		const next = forecast === null ? floor : Math.max(forecast, floor);
		slot.availablePvSurplusPowerW = next;
		slot.remainingPvSurplusPowerW = next;
		if (slot.fixedBalancePowerW !== null) {
			slot.fixedBalancePowerW = Math.max(slot.fixedBalancePowerW, floor);
		}
		return;
	}
}
