/**
 * Phase-4 EV planner diagnosis → wallbox.ev_foundation states.
 * Planning-only. No EVCC / Tibber / Sonnen / Ford / go-e writes.
 */

import type { StateHost } from "../../../ems_light/state_util";
import { WALLBOX_EV_FOUNDATION_STATES } from "../../../addons/wallbox/ev_foundation/ensure_states";
import { setOptionalNumberIfChanged, setStateIfChanged } from "../../../policy/core/state_write";
import type { UnifiedEvPlannerDiagnosis } from "./types";

export async function publishEvPlannerDiagnosis(
	host: StateHost,
	diag: UnifiedEvPlannerDiagnosis | null | undefined,
): Promise<void> {
	const d = diag ?? null;
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.evPlannerParticipating, d?.participating === true);
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.evPlannerRole, d?.role ?? "electric_vehicle");
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.evManagementMode, d?.managementMode ?? "unavailable");
	await setOptionalNumberIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.evHardEnergyKwh, d?.hardEnergyKwh ?? null);
	await setOptionalNumberIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.evTargetEnergyKwh, d?.targetEnergyKwh ?? null);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.evAcEnergyRequiredKwh,
		d?.acEnergyRequiredKwh ?? null,
	);
	await setOptionalNumberIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.evPlannedEnergyKwh, d?.plannedEnergyKwh ?? null);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.evUnplannedEnergyKwh,
		d?.unplannedEnergyKwh ?? null,
	);
	await setOptionalNumberIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.evPlannedCostEur, d?.plannedCostEur ?? null);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.evPlannedPvEnergyKwh,
		d?.plannedPvEnergyKwh ?? null,
	);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.evPlannedGridEnergyKwh,
		d?.plannedGridEnergyKwh ?? null,
	);
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.evPlannedFirstStart, d?.plannedFirstStart ?? "");
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.evPlannedLastEnd, d?.plannedLastEnd ?? "");
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.evPlanQuality, d?.planQuality ?? "unknown");
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.evPlanJson,
		d ? JSON.stringify({ ...d.explain, managementMode: d.managementMode, plannedEnergyKwh: d.plannedEnergyKwh }) : "{}",
	);
}
