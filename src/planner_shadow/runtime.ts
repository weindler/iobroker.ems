import {
	getPlannerOnDemandCoordinator,
	setPlannerOnDemandCoordinatorEnabled,
} from "../planner_coordinator/compose";
import type { PlannerCoordinatorStatus, PlannerTriggerReason } from "../planner_coordinator/types";
import type { StateHost } from "../ems_light/state_util";
import { plannerRuntimeModeFromConfig } from "../planner_config";
import {
	PlannerTriggerSystem,
	type AggregatedTriggerRequest,
} from "../planner_trigger";
import {
	isPlannerCoordinatorState,
	PLANNER_COORDINATOR_STATE_IDS,
} from "./ensure_states";
import { initialSessionShadowFromNative, resolveEffectivePlannerMode } from "./mode";
import { writePlannerCoordinatorStatusStates } from "./status_bridge";

export type PlannerShadowRuntimeHost = StateHost & {
	namespace: string;
	config?: unknown;
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
let sessionShadowEnabled = false;
let configuredMode = "off" as import("../planner_config").PlannerRuntimeMode;
let unloadStopped = false;
let triggerSystem: PlannerTriggerSystem | null = null;

function isConsciousButtonRequest(val: unknown, ack: boolean | undefined): boolean {
	return val === true && ack !== true;
}

async function resetButton(host: PlannerShadowRuntimeHost, stateId: string): Promise<void> {
	await host.setStateAsync(stateId, { val: false, ack: true });
}

async function setStateIfChangedSafe(host: PlannerShadowRuntimeHost, id: string, val: ioBroker.StateValue): Promise<void> {
	const cur = await host.getStateAsync(id);
	if (cur?.val === val && cur?.ack === true) return;
	await host.setStateAsync(id, { val, ack: true });
}

async function writeModeStates(host: PlannerShadowRuntimeHost): Promise<void> {
	const effective = resolveEffectivePlannerMode({
		config: { planner_runtime_mode: configuredMode },
		sessionShadowEnabled,
	});
	await setStateIfChangedSafe(host, PLANNER_COORDINATOR_STATE_IDS.configuredMode, effective.configuredMode);
	await setStateIfChangedSafe(host, PLANNER_COORDINATOR_STATE_IDS.effectiveMode, effective.effectiveMode);
	await setStateIfChangedSafe(host, PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, sessionShadowEnabled);
}

async function applySessionAndCoordinator(host: PlannerShadowRuntimeHost): Promise<void> {
	const effective = resolveEffectivePlannerMode({
		config: { planner_runtime_mode: configuredMode },
		sessionShadowEnabled,
	});
	await setPlannerOnDemandCoordinatorEnabled(effective.coordinatorEnabled);
	await writeModeStates(host);
}

async function onCoordinatorStatus(status: PlannerCoordinatorStatus): Promise<void> {
	const host = runtimeHost;
	if (!host || unloadStopped) return;
	const diag = triggerSystem?.getDiagnostics();
	await writePlannerCoordinatorStatusStates(host, status, diag);
}

function mapAggregatedToCoordinatorReason(req: AggregatedTriggerRequest): PlannerTriggerReason {
	if (req.reasonCode === "manual" || req.reasonCode === "manual_force") return "manual";
	if (req.reasonCode === "startup") return "startup_recovery";
	if (req.reasonCode.startsWith("schedule_")) return "scheduled";
	return "relevant_change";
}

async function onAggregatedTrigger(req: AggregatedTriggerRequest): Promise<void> {
	if (unloadStopped) return;
	const coordinator = getPlannerOnDemandCoordinator();
	if (!coordinator) return;
	const host = runtimeHost;
	if (host) {
		await setStateIfChangedSafe(host, PLANNER_COORDINATOR_STATE_IDS.lastTriggerClass, req.primaryClass);
		await setStateIfChangedSafe(host, PLANNER_COORDINATOR_STATE_IDS.lastCoalescedCount, req.coalescedCount);
		await setStateIfChangedSafe(host, PLANNER_COORDINATOR_STATE_IDS.lastAutoRequestAt, req.lastObservedAt);
		const diag = triggerSystem?.getDiagnostics();
		if (diag?.nextScheduledAt) {
			await setStateIfChangedSafe(host, PLANNER_COORDINATOR_STATE_IDS.nextScheduledAt, diag.nextScheduledAt);
		}
		await setStateIfChangedSafe(host, PLANNER_COORDINATOR_STATE_IDS.triggerPending, false);
	}
	await coordinator.request({
		reason: mapAggregatedToCoordinatorReason(req),
		requestedAt: req.lastObservedAt,
		force: req.force,
	});
}

export async function initPlannerShadowRuntime(host: PlannerShadowRuntimeHost): Promise<void> {
	runtimeHost = host;
	unloadStopped = false;

	const parsed = plannerRuntimeModeFromConfig(host.config);
	configuredMode = parsed.mode;
	if (parsed.clamped) {
		host.log.warn(`planner_runtime_mode invalid — clamped to off (raw=${String(parsed.raw)})`);
	}

	// Discard any persisted session grant; arm only from native mode.
	sessionShadowEnabled = initialSessionShadowFromNative(configuredMode);
	await applySessionAndCoordinator(host);

	triggerSystem?.stop();
	triggerSystem = new PlannerTriggerSystem({
		mode: resolveEffectivePlannerMode({
			config: { planner_runtime_mode: configuredMode },
			sessionShadowEnabled,
		}).effectiveMode,
		onRequest: (req) => {
			void onAggregatedTrigger(req).catch((e) => {
				host.log.warn(`planner trigger request: ${String(e)}`);
			});
		},
		enableStartupTrigger: true,
	});
	triggerSystem.start();

	const coordinator = getPlannerOnDemandCoordinator();
	if (coordinator) {
		statusUnsubscribe?.();
		statusUnsubscribe = coordinator.subscribeStatus((status) => {
			void onCoordinatorStatus(status).catch((e) => {
				host.log.warn(`planner shadow status write: ${String(e)}`);
			});
		});
		await writePlannerCoordinatorStatusStates(host, coordinator.getStatus(), triggerSystem.getDiagnostics());
	}

	if (typeof host.subscribeStatesAsync === "function") {
		for (const pattern of SUBSCRIBED_PATTERNS) {
			await host.subscribeStatesAsync(pattern);
		}
	}
}

export async function stopPlannerShadowRuntime(): Promise<void> {
	unloadStopped = true;
	triggerSystem?.stop();
	triggerSystem = null;
	const host = runtimeHost;
	if (host && typeof host.unsubscribeStatesAsync === "function") {
		for (const pattern of SUBSCRIBED_PATTERNS) {
			await host.unsubscribeStatesAsync(pattern).catch(() => undefined);
		}
	}
	statusUnsubscribe?.();
	statusUnsubscribe = null;
	await setPlannerOnDemandCoordinatorEnabled(false);
	sessionShadowEnabled = false;
	runtimeHost = null;
}

export function isPlannerShadowEnabledForTest(): boolean {
	return sessionShadowEnabled;
}

export function getPlannerConfiguredModeForTest(): string {
	return configuredMode;
}

export function getPlannerEffectiveModeForTest(): string {
	return resolveEffectivePlannerMode({
		config: { planner_runtime_mode: configuredMode },
		sessionShadowEnabled,
	}).effectiveMode;
}

/**
 * Observe non-coordinator state changes for auto triggers (shadow_auto only).
 * Lightweight — catalog match only; heavy modules stay unloaded.
 */
export function observePlannerTriggerStateChange(relativeId: string, ack: boolean | undefined): boolean {
	if (unloadStopped || !triggerSystem) return false;
	if (isPlannerCoordinatorState(relativeId)) return false;
	return triggerSystem.observeStateChange(relativeId, ack);
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
		// Session override only — never writes native config.
		// Cannot elevate above native off.
		const requested = val === true;
		if (configuredMode === "off") {
			sessionShadowEnabled = false;
			await applySessionAndCoordinator(host);
			host.log.debug?.("planner shadow session ignored — native mode is off");
			return true;
		}
		sessionShadowEnabled = requested;
		await applySessionAndCoordinator(host);
		return true;
	}

	if (relativeId === PLANNER_COORDINATOR_STATE_IDS.manualTrigger) {
		if (!isConsciousButtonRequest(val, ack)) return true;
		await resetButton(host, relativeId);
		const effective = resolveEffectivePlannerMode({
			config: { planner_runtime_mode: configuredMode },
			sessionShadowEnabled,
		});
		if (!effective.allowsManual) {
			const coordinator = getPlannerOnDemandCoordinator();
			if (coordinator) {
				await coordinator.request({ reason: "manual", requestedAt: new Date().toISOString(), force: false });
			}
			return true;
		}
		triggerSystem?.requestManual(false);
		return true;
	}

	if (relativeId === PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger) {
		if (!isConsciousButtonRequest(val, ack)) return true;
		await resetButton(host, relativeId);
		const effective = resolveEffectivePlannerMode({
			config: { planner_runtime_mode: configuredMode },
			sessionShadowEnabled,
		});
		if (!effective.allowsManual) {
			const coordinator = getPlannerOnDemandCoordinator();
			if (coordinator) {
				await coordinator.request({ reason: "manual", requestedAt: new Date().toISOString(), force: true });
			}
			return true;
		}
		triggerSystem?.requestManual(true);
		return true;
	}

	return true;
}
