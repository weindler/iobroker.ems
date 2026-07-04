import type { PlannerHost } from "./inputs";
import { ensurePlannerStates } from "./ensure_states";
import { runPlannerTick } from "./run";

export type { PlannerIntent } from "./types";
export type { PlannerHost } from "./inputs";
export { readPlannerThermalStage, readPlannerInputs } from "./inputs";
export { runPlanner, runPlannerTick, resetPlannerRevisionForTest } from "./run";
export { planThermal } from "./rules/thermal";
export { planBattery, buildPlannerConstraints } from "./rules/battery";
export { plannerModePolicyFromGlobalMode } from "./mode_policy";
export { deviceIntentFromPlannerDecision } from "./battery_bridge";

export async function initPlanner(host: PlannerHost): Promise<void> {
	await ensurePlannerStates(host);
	await runPlannerTick(host);
}

export async function stopPlanner(): Promise<void> {
	// stateless — nothing to tear down
}
