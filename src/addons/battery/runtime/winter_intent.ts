import type { BatteryWinterChargeWindow } from "../../../planner/rules/battery_winter";
import { isNowInWinterChargeWindow } from "../../../planner/rules/battery_winter_windows";
import type { BatteryDeviceIntent } from "../core/types";

export interface WinterPlannerSnapshot {
	active: boolean;
	socTargetPct: number | null;
	maxChargeW: number;
	windows: BatteryWinterChargeWindow[];
	reasonDe: string;
	revision: number;
}

function numOrNull(v: unknown): number | null {
	if (v === null || v === undefined || v === "" || v === -1) return null;
	const n = typeof v === "number" ? v : parseFloat(String(v));
	return Number.isFinite(n) ? n : null;
}

export function parseWinterWindowsJson(raw: unknown): BatteryWinterChargeWindow[] {
	if (!raw) return [];
	try {
		const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(w): w is BatteryWinterChargeWindow =>
				w != null &&
				typeof w === "object" &&
				typeof (w as BatteryWinterChargeWindow).start_iso === "string" &&
				typeof (w as BatteryWinterChargeWindow).end_iso === "string",
		);
	} catch {
		return [];
	}
}

export function deviceIntentFromWinterPlanner(
	snap: WinterPlannerSnapshot,
	nowMs: number,
): BatteryDeviceIntent | null {
	if (!snap.active || snap.maxChargeW <= 0) return null;
	const window = isNowInWinterChargeWindow(nowMs, snap.windows);
	if (!window) return null;

	return {
		requestId: `winter-planner-${snap.revision}`,
		action: "grid_charge",
		targetSocPct: snap.socTargetPct,
		maxChargeW: snap.maxChargeW,
		maxDischargeW: null,
		energySource: "grid",
		validFrom: window.start_iso,
		validUntil: window.end_iso,
		issuedAt: new Date(nowMs).toISOString(),
		reason: `Winter-Netz ${window.strategy}: ${snap.reasonDe}`,
		source: "winter_planner",
	};
}

export { numOrNull as winterNumOrNull };
