import type { StateHost } from "../../ems_light/state_util";
import { setOptionalNumberIfChanged, setStateIfChanged } from "../../policy/core/state_write";
import { addonAllocationPublishView } from "../../operator/daily_plan/addon_plan_publish";
import type { DailyPlan } from "../../operator/daily_plan/types";
import { ALLOCATION_ADDON_STATE_IDS, DAILY_PLAN_STATE_IDS } from "../../operator/daily_plan/states";

/** Nur get/set — setStateIfChanged braucht typseitig StateHost (setObject*), daher Cast. */
export type WritebackPublishHost = {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	log?: { warn?: (m: string) => void };
};

function asStateHost(host: WritebackPublishHost): StateHost {
	return host as unknown as StateHost;
}

/** Schreibt Daily-Plan- + Allocation-States nach KI-Write-back (Plan B) neu. */
export async function republishDailyPlanAfterWriteback(
	host: WritebackPublishHost,
	plan: DailyPlan,
): Promise<void> {
	const h = asStateHost(host);
	try {
		await setStateIfChanged(h, DAILY_PLAN_STATE_IDS.status, plan.status);
		await setStateIfChanged(h, DAILY_PLAN_STATE_IDS.reasonDe, plan.reasonDe);
		await setStateIfChanged(h, DAILY_PLAN_STATE_IDS.slotsJson, JSON.stringify(plan.slots));
		await setStateIfChanged(h, DAILY_PLAN_STATE_IDS.allocationsJson, JSON.stringify(plan.allocations));
		await setStateIfChanged(h, DAILY_PLAN_STATE_IDS.planJson, JSON.stringify(plan));
		await setOptionalNumberIfChanged(h, DAILY_PLAN_STATE_IDS.revision, plan.revision);

		const addonSummaries: Array<{ key: keyof typeof ALLOCATION_ADDON_STATE_IDS; prefix: string }> = [
			{ key: "battery", prefix: "battery" },
			{ key: "wallbox", prefix: "wallbox" },
			{ key: "immersion_heater", prefix: "immersion_heater" },
			{ key: "air_conditioning", prefix: "air_conditioning" },
		];
		for (const { key, prefix } of addonSummaries) {
			const ids = ALLOCATION_ADDON_STATE_IDS[key];
			const view = addonAllocationPublishView(plan, prefix, { kiWriteback: true });
			await setStateIfChanged(h, ids.status, view.status);
			await setStateIfChanged(h, ids.planJson, JSON.stringify(view.runnable));
			await setStateIfChanged(h, ids.reasonDe, view.reasonDe);
		}
	} catch (e) {
		host.log?.warn?.(`KI Write-back publish: ${String(e)}`);
	}
}
