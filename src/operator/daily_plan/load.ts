import type { StateHost } from "../../ems_light/state_util";
import { readDailyPlanFile, type PlanPathHost } from "../plan_store";
import { DAILY_PLAN_STATE_IDS } from "./states";

type DailyPlanLoadHost = PlanPathHost & Pick<StateHost, "getStateAsync">;

async function readStr(host: Pick<StateHost, "getStateAsync">, relId: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(relId);
		if (st?.val == null || st.val === "") return null;
		return String(st.val);
	} catch {
		return null;
	}
}

/** Full daily plan JSON — file first, legacy ioBroker state fallback for migration. */
export async function readDailyPlanJsonRaw(host: DailyPlanLoadHost): Promise<string | null> {
	const fromFile = await readDailyPlanFile(host);
	if (fromFile) return fromFile;
	return readStr(host, DAILY_PLAN_STATE_IDS.planJson);
}
