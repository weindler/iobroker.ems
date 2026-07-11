import { setStateIfChanged } from "../../../policy/core/state_write";
import type { StateHost } from "../../../ems_light/state_util";
import { WALLBOX_RUNTIME_STATES } from "./states";
import type { WallboxPlanDecision } from "./daily_plan";

export async function publishWallboxRuntimeStates(
	host: StateHost,
	decision: WallboxPlanDecision,
	governanceAllowed: boolean,
): Promise<void> {
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.decisionSource, decision.decisionSource);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.reasonDe, decision.reasonDe);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dailyPlanStatus, decision.dailyPlanStatus);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dailyPlanValid, decision.planValid);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dailyPlanRevision, decision.dailyPlanRevision ?? 0);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dailyPlanSlotStart, decision.slotStartIso ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dailyPlanSlotEnd, decision.slotEndIso ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.connected, decision.connected);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.chargingAllowedByPlan, decision.chargingAllowedByPlan);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.allocatedPowerW, decision.allocatedPowerW ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.allocatedEnergyKwh, decision.allocatedEnergyKwh ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.allocatedPvPowerW, decision.pvPowerW ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.allocatedGridPowerW, decision.gridPowerW ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.energySource, decision.energySource);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.deadlineIso, decision.deadlineIso ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.remainingEnergyKwh, decision.remainingEnergyKwh ?? "");
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.plannedEnergyUntilDeadlineKwh,
		decision.plannedEnergyUntilDeadlineKwh,
	);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.plannedPvEnergyUntilDeadlineKwh,
		decision.plannedPvEnergyUntilDeadlineKwh,
	);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.plannedGridEnergyUntilDeadlineKwh,
		decision.plannedGridEnergyUntilDeadlineKwh,
	);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.plannedCostUntilDeadlineCt,
		decision.plannedCostUntilDeadlineCt ?? "",
	);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.deadlineReachable,
		decision.deadlineReachable === null
			? "unknown"
			: decision.deadlineReachable
				? "true"
				: "false",
	);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.firstPlannedSlot, decision.firstPlannedSlot ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.lastPlannedSlot, decision.lastPlannedSlot ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.activePlannedSlots, decision.activePlannedSlots);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.maxPlannedPowerW, decision.maxPlannedPowerW);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.minChargePowerW, decision.minChargePowerW ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.maxChargePowerW, decision.maxChargePowerW ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.planExecutionStatus, decision.planExecutionStatus);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.externalPlanActive, decision.externalPlanActive);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.externalPlanTime, decision.externalPlanTime ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.governanceAllowed, governanceAllowed);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.runtimeControlAvailable, false);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeAllowed, false);
}

export { ensureWallboxRuntimeStates } from "./ensure_states";
export { resetWallboxDailyPlanCache, resolveWallboxDailyPlanDecision } from "./daily_plan";
