import type { StateHost } from "../ems_light/state_util";
import { readPlannerIntentFile, type PlanPathHost } from "../operator/plan_store";

const PLANNER_INTENT_STATE_ID = "planner.intent.last_json";

type PlannerIntentLoadHost = PlanPathHost & Pick<StateHost, "getStateAsync">;

async function readStr(host: PlannerIntentLoadHost, relId: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(relId);
		if (st?.val == null || st.val === "") return null;
		return String(st.val);
	} catch {
		return null;
	}
}

/** Planner intent JSON — file first, legacy ioBroker state fallback for migration. */
export async function readPlannerIntentJsonRaw(host: PlannerIntentLoadHost): Promise<string | null> {
	const fromFile = await readPlannerIntentFile(host);
	if (fromFile) return fromFile;
	return readStr(host, PLANNER_INTENT_STATE_ID);
}
