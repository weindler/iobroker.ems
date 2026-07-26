import { computeDeficitW } from "../planning/battery";
import { computePvSurplusW } from "../planning/surplus";
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
