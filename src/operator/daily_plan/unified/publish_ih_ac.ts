/**
 * Publiziert Unified-IH/AC-Dispatch ausschließlich auf planner.intent.allocation.*
 * Der Planner schreibt keine Geräte-States.
 *
 * Produktions-Tick nutzt bevorzugt applyUnifiedIhAcAuthority + einmaligen Plan-Publish.
 * Diese Hilfsfunktion bleibt für gezielte Slice-Writes/Tests.
 */

import type { StateHost } from "../../../ems_light/state_util";
import { setStateIfChanged } from "../../../policy/core/state_write";
import { resetImmersionDailyPlanCache } from "../../../addons/immersion_heater/runtime/daily_plan";
import { resetAcDailyPlanCache } from "../../../addons/air_conditioning/runtime/daily_plan";
import { ALLOCATION_ADDON_STATE_IDS } from "../states";
import type { UnifiedDayPlan } from "./types";
import { buildUnifiedIhAcDispatchPublish } from "./dispatch_bridge";

export type UnifiedIhAcPublishHost = Pick<StateHost, "setStateAsync" | "getStateAsync"> & {
	log?: { warn?: (msg: string) => void; info?: (msg: string) => void; debug?: (msg: string) => void };
};

/**
 * Überschreibt nur Immersion- und Klima-Allocation-Slices.
 * Battery/Wallbox bleiben unberührt.
 */
export async function publishUnifiedIhAcDispatch(
	host: UnifiedIhAcPublishHost,
	plan: UnifiedDayPlan,
): Promise<{ immersionCount: number; climateCount: number }> {
	const pub = buildUnifiedIhAcDispatchPublish(plan);
	const ih = ALLOCATION_ADDON_STATE_IDS.immersion_heater;
	const ac = ALLOCATION_ADDON_STATE_IDS.air_conditioning;

	// setStateIfChanged braucht formal StateHost; Overlay nutzt nur get/setState.
	const writeHost = host as StateHost;
	await setStateIfChanged(writeHost, ih.status, pub.immersionStatus);
	await setStateIfChanged(writeHost, ih.planJson, JSON.stringify(pub.immersionEntries));
	await setStateIfChanged(writeHost, ih.reasonDe, pub.immersionReasonDe);

	await setStateIfChanged(writeHost, ac.status, pub.climateStatus);
	await setStateIfChanged(writeHost, ac.planJson, JSON.stringify(pub.climateEntries));
	await setStateIfChanged(writeHost, ac.reasonDe, pub.climateReasonDe);

	// Slice geändert ohne Daily-Plan-Revision → Runtime-Caches invalidieren.
	resetImmersionDailyPlanCache();
	resetAcDailyPlanCache();

	host.log?.debug?.(
		`unified ih/ac dispatch: ih=${pub.immersionEntries.length} ac=${pub.climateEntries.length}`,
	);
	return { immersionCount: pub.immersionEntries.length, climateCount: pub.climateEntries.length };
}
