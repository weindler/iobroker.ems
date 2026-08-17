/**
 * Phase-4 EV planner diagnosis stays in memory. No public ioBroker copy of the plan blob.
 */

import type { StateHost } from "../../../ems_light/state_util";
import type { UnifiedEvPlannerDiagnosis } from "./types";

export async function publishEvPlannerDiagnosis(
	_host: StateHost,
	_diag: UnifiedEvPlannerDiagnosis | null | undefined,
): Promise<void> {
	/* Planner-Diagnose bleibt intern (Daily Plan + Allocation). */
}
