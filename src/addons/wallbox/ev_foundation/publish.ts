import type { StateHost } from "../../../ems_light/state_util";
import { setOptionalNumberIfChanged, setStateIfChanged } from "../../../policy/core/state_write";
import type { EvCapabilities, EvModelV1 } from "./types";
import { WALLBOX_EV_FOUNDATION_STATES } from "./ensure_states";
import { emptySmartPlanEval, type ExternalEvInformation } from "./external/types";
import type { EvTakeoverDecision } from "./decision/types";

export async function publishEvFoundationDiagnosis(
	host: StateHost,
	model: EvModelV1,
	_capabilities: EvCapabilities,
	_observedAt: string,
	external?: ExternalEvInformation | null,
	decision?: EvTakeoverDecision | null,
): Promise<void> {
	const plan = external?.smartPlan ?? emptySmartPlanEval();
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanJson,
		JSON.stringify(plan.slots),
	);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalMinSocPct,
		model.externalSmartChargingMinSocPct,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalAuthorityState,
		decision?.externalAuthorityState ?? model.externalAuthorityState,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.takeoverSeverity,
		decision?.takeoverSeverity ?? model.takeoverSeverity,
	);
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.preparedEvState, model.preparedEvState);
}
