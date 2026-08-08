import { computeDeficitW } from "../planning/battery";
import { computePvSurplusW } from "../planning/surplus";
import { slotStartIsoFloored } from "./slots";
import {
	applyLiveNowBalanceToCurrentSlot,
	applyLiveSurplusFloorToCurrentSlot,
	type LiveNowTelemetry,
} from "./live_now_balance";

export {
	applyLiveNowBalanceToCurrentSlot,
	applyLiveSurplusFloorToCurrentSlot,
	computeLiveNowBalanceW,
	isLiveNowTelemetryUsable,
	isPlausibleLivePowerW,
	LIVE_NOW_MAX_AGE_SEC,
	slotBalanceIsConsistent,
} from "./live_now_balance";
export type { LiveNowTelemetry, NowBalanceW } from "./live_now_balance";

/**
 * Roadmap Block 3.3: Live-PV-Überschuss/-Defizit für Diagnose/VIS kommt ab hier direkt aus dem
 * Live-Cache (`live.pv.power_w` / `live.battery.pv_ac_power_w` / `live.battery.house_load_w`).
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

/** Convenience: Live-NOW-Bilanz auf Daily-Plan-Slots anwenden. */
export function applyLiveNowFromSurplusResult(
	slots: Parameters<typeof applyLiveNowBalanceToCurrentSlot>[0],
	nowMs: number,
	live: OperatorLiveSurplusResult & { pvAgeSec?: number | null; houseAgeSec?: number | null },
): boolean {
	const telemetry: LiveNowTelemetry = {
		pvPowerW: live.pvPowerW,
		houseLoadW: live.houseLoadW,
		pvAgeSec: live.pvAgeSec,
		houseAgeSec: live.houseAgeSec,
	};
	return applyLiveNowBalanceToCurrentSlot(slots, nowMs, telemetry);
}
