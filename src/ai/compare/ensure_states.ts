import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";

export const COMPARE_BASE = "compare";

export const COMPARE_STATES = {
	planAChartJson: `${COMPARE_BASE}.plan_a.chart_json`,
	planBChartJson: `${COMPARE_BASE}.plan_b.chart_json`,
	activePlan: `${COMPARE_BASE}.active_plan`,
	deltaSummaryJson: `${COMPARE_BASE}.delta_summary_json`,
	generatedAt: `${COMPARE_BASE}.generated_at`,
	planRevision: `${COMPARE_BASE}.plan_revision`,
} as const;

export async function ensureCompareStates(host: StateHost): Promise<void> {
	await ensureChannel(host, COMPARE_BASE, "Plan-Vergleich (Plan A deterministisch, Plan B KI-Simulation)");
	await ensureChannel(host, `${COMPARE_BASE}.plan_a`, "Plan A — deterministisch, tatsächlich ausgeführt");
	await ensureChannel(host, `${COMPARE_BASE}.plan_b`, "Plan B — KI-gewichtete Simulation, nur zur Beobachtung");

	const defs: StateDef[] = [
		{
			id: COMPARE_STATES.planAChartJson,
			common: {
				name: "Plan A Zeitreihe (JSON) — [{t,pv_w,grid_w,ih_w,ac_w,price_ct}], für VIS",
				type: "string",
				role: "json",
				read: true,
				write: false,
				def: "[]",
			},
			defaultVal: "[]",
		},
		{
			id: COMPARE_STATES.planBChartJson,
			common: {
				name: "Plan B Zeitreihe (JSON, Simulation) — [{t,pv_w,grid_w,ih_w,ac_w,price_ct}], für VIS",
				type: "string",
				role: "json",
				read: true,
				write: false,
				def: "[]",
			},
			defaultVal: "[]",
		},
		{
			id: COMPARE_STATES.activePlan,
			common: {
				name: "Rechnerisch günstigerer Plan (nur Anzeige — EMS führt immer Plan A aus)",
				type: "string",
				role: "text",
				read: true,
				write: false,
				def: "a",
				states: { a: "Plan A (deterministisch)", b: "Plan B (KI-Simulation, günstiger)" },
			},
			defaultVal: "a",
		},
		{
			id: COMPARE_STATES.deltaSummaryJson,
			common: {
				name: "Plan-Vergleich Zusammenfassung (JSON) — Kosten/PV/Netz/unallokiert A vs. B",
				type: "string",
				role: "json",
				read: true,
				write: false,
				def: "{}",
			},
			defaultVal: "{}",
		},
		{
			id: COMPARE_STATES.generatedAt,
			common: { name: "Plan-Vergleich zuletzt berechnet", type: "string", role: "date", read: true, write: false, def: "" },
		},
		{
			id: COMPARE_STATES.planRevision,
			common: {
				name: "Zugrundeliegende Daily-Plan-Revision",
				type: "number",
				role: "value",
				read: true,
				write: false,
				def: 0,
			},
			defaultVal: 0,
		},
	];
	await ensureStates(host, defs);
}
