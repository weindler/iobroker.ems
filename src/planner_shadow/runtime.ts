import {
	getPlannerOnDemandCoordinator,
	setPlannerOnDemandCoordinatorEnabled,
} from "../planner_coordinator/compose";
import type { PlannerCoordinatorStatus } from "../planner_coordinator/types";
import type { StateHost } from "../ems_light/state_util";
import {
	isPlannerCoordinatorState,
	PLANNER_COORDINATOR_STATE_IDS,
} from "./ensure_states";
import { writePlannerCoordinatorStatusStates } from "./status_bridge";

export type PlannerShadowRuntimeHost = StateHost & {
	namespace: string;
	log: Pick<ioBroker.Logger, "debug" | "info" | "warn" | "error">;
	subscribeStatesAsync?: (pattern: string) => Promise<void>;
	unsubscribeStatesAsync?: (pattern: string) => Promise<void>;
};

const SUBSCRIBED_PATTERNS = [
	PLANNER_COORDINATOR_STATE_IDS.shadowEnabled,
	PLANNER_COORDINATOR_STATE_IDS.manualTrigger,
	PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger,
];

let runtimeHost: PlannerShadowRuntimeHost | null = null;
let statusUnsubscribe: (() => void) | null = null;
let shadowEnabled = false;
let unloadStopped = false;

function isConsciousButtonRequest(val: unknown, ack: boolean | undefined): boolean {
	return val === true && ack !== true;
}

async function resetButton(host: PlannerShadowRuntimeHost, stateId: string): Promise<void> {
	await host.setStateAsync(stateId, { val: false, ack: true });
}

async function applyShadowEnabled(host: PlannerShadowRuntimeHost, enabled: boolean): Promise<void> {
	shadowEnabled = enabled;
	await setPlannerOnDemandCoordinatorEnabled(enabled);
	if (enabled) {
		await setStateIfChangedSafe(host, PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, true);
	} else {
		await setStateIfChangedSafe(host, PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, false);
	}
}

async function setStateIfChangedSafe(host: PlannerShadowRuntimeHost, id: string, val: ioBroker.StateValue): Promise<void> {
	const cur = await host.getStateAsync(id);
	if (cur?.val === val && cur?.ack === true) return;
	await host.setStateAsync(id, { val, ack: true });
}

async function onCoordinatorStatus(status: PlannerCoordinatorStatus): Promise<void> {
	const host = runtimeHost;
	if (!host || unloadStopped) return;
	await writePlannerCoordinatorStatusStates(host, status);
}

async function requestManualTrigger(force: boolean): Promise<void> {
	const coordinator = getPlannerOnDemandCoordinator();
	if (!coordinator) return;
	await coordinator.request({
		reason: "manual",
		requestedAt: new Date().toISOString(),
		force,
	});
}

export async function initPlannerShadowRuntime(host: PlannerShadowRuntimeHost): Promise<void> {
	runtimeHost = host;
	unloadStopped = false;
	shadowEnabled = false;
	await setPlannerOnDemandCoordinatorEnabled(false);
	await setStateIfChangedSafe(host, PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, false);

	const coordinator = getPlannerOnDemandCoordinator();
	if (coordinator) {
		statusUnsubscribe?.();
		statusUnsubscribe = coordinator.subscribeStatus((status) => {
			void onCoordinatorStatus(status).catch((e) => {
				host.log.warn(`planner shadow status write: ${String(e)}`);
			});
		});
		await writePlannerCoordinatorStatusStates(host, coordinator.getStatus());
	}

	if (typeof host.subscribeStatesAsync === "function") {
		for (const pattern of SUBSCRIBED_PATTERNS) {
			await host.subscribeStatesAsync(pattern);
		}
	}
}

export async function stopPlannerShadowRuntime(): Promise<void> {
	unloadStopped = true;
	const host = runtimeHost;
	if (host && typeof host.unsubscribeStatesAsync === "function") {
		for (const pattern of SUBSCRIBED_PATTERNS) {
			await host.unsubscribeStatesAsync(pattern).catch(() => undefined);
		}
	}
	statusUnsubscribe?.();
	statusUnsubscribe = null;
	await setPlannerOnDemandCoordinatorEnabled(false);
	shadowEnabled = false;
	runtimeHost = null;
}

export function isPlannerShadowEnabledForTest(): boolean {
	return shadowEnabled;
}

export async function handlePlannerShadowStateChange(
	host: PlannerShadowRuntimeHost,
	relativeId: string,
	val: unknown,
	ack: boolean | undefined,
): Promise<boolean> {
	if (!isPlannerCoordinatorState(relativeId)) {
		return false;
	}
	if (unloadStopped) {
		return true;
	}

	if (relativeId === PLANNER_COORDINATOR_STATE_IDS.shadowEnabled) {
		if (ack === true) return true;
		const enabled = val === true;
		await applyShadowEnabled(host, enabled);
		return true;
	}

	if (relativeId === PLANNER_COORDINATOR_STATE_IDS.manualTrigger) {
		if (!isConsciousButtonRequest(val, ack)) return true;
		await resetButton(host, relativeId);
		if (!shadowEnabled) {
			const coordinator = getPlannerOnDemandCoordinator();
			if (coordinator) {
				await coordinator.request({ reason: "manual", requestedAt: new Date().toISOString(), force: false });
			}
			return true;
		}
		await requestManualTrigger(false);
		return true;
	}

	if (relativeId === PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger) {
		if (!isConsciousButtonRequest(val, ack)) return true;
		await resetButton(host, relativeId);
		if (!shadowEnabled) {
			const coordinator = getPlannerOnDemandCoordinator();
			if (coordinator) {
				await coordinator.request({ reason: "manual", requestedAt: new Date().toISOString(), force: true });
			}
			return true;
		}
		await requestManualTrigger(true);
		return true;
	}

	return true;
}
