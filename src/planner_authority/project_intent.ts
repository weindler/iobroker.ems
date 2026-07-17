/**
 * Compact projector: writes the worker-dryrun authoritative view's slot allocations
 * into the existing intent allocation states so device runtimes keep working without
 * reading candidates directly.
 *
 * Fidelity note: candidate allocations are compact (power/energy/status only). Energy
 * source split (grid vs pv) is not carried, so projected entries default to a
 * conservative pv-surplus attribution. Grid-charging intent is intentionally NOT
 * fabricated from a worker candidate.
 */

import type { StateHost } from "../ems_light/state_util";
import { setStateIfChanged } from "../policy/core/state_write";
import {
	ALLOCATION_ADDON_STATE_IDS,
	DAILY_PLAN_STATE_IDS,
} from "../operator/daily_plan/states";
import { localDateKeyInTimezone } from "../operator/time";
import type { AuthoritativePlannerSlot, AuthoritativePlannerView } from "./types";

type AddonKey = keyof typeof ALLOCATION_ADDON_STATE_IDS;

const ADDON_PREFIXES: Array<{ prefix: string; addon: AddonKey }> = [
	{ prefix: "battery.", addon: "battery" },
	{ prefix: "wallbox.", addon: "wallbox" },
	{ prefix: "immersion_heater.", addon: "immersion_heater" },
	{ prefix: "air_conditioning.", addon: "air_conditioning" },
];

function addonForContribution(contributionId: string): AddonKey | null {
	for (const { prefix, addon } of ADDON_PREFIXES) {
		if (contributionId.startsWith(prefix)) return addon;
	}
	return null;
}

interface ProjectedAllocation {
	contributionId: string;
	slot: { startIso: string; endIso: string };
	status: string;
	powerW: number | null;
	energyKwh: number | null;
	energySource: "pv_surplus";
}

function projectSlot(
	slot: AuthoritativePlannerSlot,
	byAddon: Map<AddonKey, ProjectedAllocation[]>,
): void {
	for (const a of slot.allocations) {
		const addon = addonForContribution(a.contributionId);
		if (!addon) continue;
		const list = byAddon.get(addon) ?? [];
		list.push({
			contributionId: a.contributionId,
			slot: { startIso: slot.slotStart, endIso: slot.slotEnd },
			status: a.status,
			powerW: a.powerW,
			energyKwh: a.energyKwh,
			energySource: "pv_surplus",
		});
		byAddon.set(addon, list);
	}
}

export interface ProjectWorkerViewInput {
	view: AuthoritativePlannerView;
	now: Date;
	timezone: string;
	globalMode: string;
	slotMinutes?: number;
}

/**
 * Project the current + next slot allocations of a worker-dryrun view into the
 * existing allocation + daily plan meta states. No-op if the view is not a usable
 * worker view.
 */
export async function projectWorkerViewToIntentStates(
	host: StateHost,
	input: ProjectWorkerViewInput,
): Promise<void> {
	const { view } = input;
	if (view.source !== "worker_dryrun") return;
	if (view.quality !== "valid" || !view.currentSlot) return;

	const byAddon = new Map<AddonKey, ProjectedAllocation[]>();
	projectSlot(view.currentSlot, byAddon);
	if (view.nextSlot) projectSlot(view.nextSlot, byAddon);

	for (const addon of Object.keys(ALLOCATION_ADDON_STATE_IDS) as AddonKey[]) {
		const entries = byAddon.get(addon) ?? [];
		const ids = ALLOCATION_ADDON_STATE_IDS[addon];
		await setStateIfChanged(host, ids.planJson, JSON.stringify(entries));
		await setStateIfChanged(host, ids.status, entries.length > 0 ? "ready" : "not_initialized");
		await setStateIfChanged(host, ids.reasonDe, "Worker-Dryrun-Projektion (kompakt).");
	}

	const localDate = localDateKeyInTimezone(input.now, input.timezone);
	const validUntil = view.nextSlot?.slotEnd ?? view.currentSlot.slotEnd;
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.status, "ready");
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.date, localDate);
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.globalMode, input.globalMode);
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.slotMinutes, input.slotMinutes ?? 15);
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.generatedAt, input.now.toISOString());
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.validUntil, validUntil);
	await setStateIfChanged(host, DAILY_PLAN_STATE_IDS.revision, view.generation ?? 0);
}
