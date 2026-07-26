import type { StateHost } from "../../ems_light/state_util";
import { setOptionalNumberIfChanged, setStateIfChanged } from "../../policy/core/state_write";
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

function addonAllocationSummary(plan: DailyPlan, addonPrefix: string) {
	if (addonPrefix === "air_conditioning") {
		return plan.allocations.filter((a) => a.contributionId.startsWith("air_conditioning."));
	}
	return plan.allocations.filter(
		(a) =>
			a.contributionId === addonPrefix ||
			a.contributionId.startsWith(`${addonPrefix}.`) ||
			(a.contributor.id === addonPrefix && addonPrefix !== "air_conditioning"),
	);
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
			const summary = addonAllocationSummary(plan, prefix);
			await setStateIfChanged(h, ids.status, summary.length > 0 ? "ready" : "idle");
			await setStateIfChanged(h, ids.planJson, JSON.stringify(summary));
			await setStateIfChanged(
				h,
				ids.reasonDe,
				summary.length > 0
					? `${summary.length} Allocation-Einträge für ${prefix} (ggf. KI Plan B).`
					: `Keine Allocation für ${prefix}.`,
			);
		}
	} catch (e) {
		host.log?.warn?.(`KI Write-back publish: ${String(e)}`);
	}
}
