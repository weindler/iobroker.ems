import {
	getPlannerOnDemandCoordinator,
	setPlannerOnDemandCoordinatorEnabled,
} from "../planner_coordinator/compose";
import type { PlannerCoordinatorStatus, PlannerTriggerReason } from "../planner_coordinator/types";
import type { StateHost } from "../ems_light/state_util";
import {
	plannerRuntimeModeFromConfig,
	plannerTakeoverEvaluationModeFromConfig,
	type PlannerTakeoverEvaluationMode,
} from "../planner_config";
import {
	PlannerTriggerSystem,
	type AggregatedTriggerRequest,
} from "../planner_trigger";
import { resolvePlannerPaths } from "../planner_paths/paths";
import {
	isPlannerCoordinatorState,
	PLANNER_COORDINATOR_STATE_IDS,
} from "./ensure_states";
import { initialSessionShadowFromNative, resolveEffectivePlannerMode } from "./mode";
import { writePlannerCoordinatorStatusStates } from "./status_bridge";
import { configureDualRunSession } from "../planner_takeover/session";
import { setOptionalNumberIfChanged } from "../policy/core/state_write";

export type PlannerShadowRuntimeHost = StateHost & {
	namespace: string;
	config?: unknown;
	log: Pick<ioBroker.Logger, "debug" | "info" | "warn" | "error">;
	subscribeStatesAsync?: (pattern: string) => Promise<void>;
	unsubscribeStatesAsync?: (pattern: string) => Promise<void>;
	/** Test/injection only — production resolves via adapter-core. */
	durableDataDir?: string;
	/**
	 * Preferred path contract for resolvePlannerPaths (real adapter or durable string).
	 * When set, used instead of the host object itself.
	 */
	pathInput?: import("../backup_integration/paths").PathResolverInput;
};

const SUBSCRIBED_PATTERNS = [
	PLANNER_COORDINATOR_STATE_IDS.shadowEnabled,
	PLANNER_COORDINATOR_STATE_IDS.manualTrigger,
	PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger,
];

const TAKEOVER_STATE_PREFIX = "planner.takeover.";

function isPlannerTakeoverStateId(relativeId: string): boolean {
	return relativeId.startsWith(TAKEOVER_STATE_PREFIX);
}

let runtimeHost: PlannerShadowRuntimeHost | null = null;
let statusUnsubscribe: (() => void) | null = null;
let sessionShadowEnabled = false;
let configuredMode = "off" as import("../planner_config").PlannerRuntimeMode;
let configuredEvaluationMode: PlannerTakeoverEvaluationMode = "disabled";
let unloadStopped = false;
let triggerSystem: PlannerTriggerSystem | null = null;
let authAuthorityRuntimesStarted = false;

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

	// Do not create/write takeover stubs while runtime mode is off (objects may not exist).
	if (effective.effectiveMode === "off") {
		return;
	}

	const observing = effective.effectiveMode === "shadow_auto" && configuredEvaluationMode === "observe";
	await setStateIfChangedSafe(host, "planner.takeover.configured_evaluation_mode", configuredEvaluationMode);
	await setStateIfChangedSafe(host, "planner.takeover.effective_evaluation_mode", observing ? "observe" : "disabled");
	if (!observing) {
		await setStateIfChangedSafe(host, "planner.takeover.state", "not_evaluated");
		await setStateIfChangedSafe(host, "planner.takeover.canonical_allowed", false);
		await setStateIfChangedSafe(host, "planner.takeover.would_be_eligible", false);
		await setStateIfChangedSafe(
			host,
			"planner.takeover.block_reason",
			effective.effectiveMode === "shadow_auto" ? "evaluation_disabled" : "runtime_mode_not_auto",
		);
	}
}

async function applySessionAndCoordinator(host: PlannerShadowRuntimeHost): Promise<void> {
	const effective = resolveEffectivePlannerMode({
		config: { planner_runtime_mode: configuredMode },
		sessionShadowEnabled,
	});
	configureDualRunSession({
		plannerRuntimeMode: effective.effectiveMode,
		configuredEvaluationMode,
		stateHost: host,
	});
	// Keep auth/authority cores unloaded while native mode is off.
	if (effective.effectiveMode !== "off") {
		try {
			const { configureAuthorizationSession, getAuthorizationSession } = await import(
				"../planner_authorization/runtime_session.js"
			);
			const prev = getAuthorizationSession();
			const modeChanged =
				prev.runtimeMode !== effective.effectiveMode || prev.evaluationMode !== configuredEvaluationMode;
			configureAuthorizationSession({
				runtimeMode: effective.effectiveMode,
				evaluationMode: configuredEvaluationMode,
			});
			if (modeChanged && prev.service) {
				await prev.service.invalidate("mode_change");
				await prev.service.syncFromConfig();
			}
		} catch {
			// optional
		}
		try {
			const { configureAuthoritySession, getAuthoritySession } = await import(
				"../planner_authority/runtime_session.js"
			);
			configureAuthoritySession({
				runtimeMode: effective.effectiveMode,
				evaluationMode: configuredEvaluationMode,
			});
			const authorityChangedOff =
				effective.effectiveMode !== "shadow_auto" || configuredEvaluationMode !== "observe";
			const authoritySvc = getAuthoritySession().service;
			if (authorityChangedOff && authoritySvc) {
				await authoritySvc.fallback("mode_change");
			}
		} catch {
			// optional
		}
	}
	await setPlannerOnDemandCoordinatorEnabled(effective.coordinatorEnabled);
	await writeModeStates(host);
}

async function onCoordinatorStatus(status: PlannerCoordinatorStatus): Promise<void> {
	const host = runtimeHost;
	if (!host || unloadStopped) return;
	const diag = triggerSystem?.getDiagnostics();
	await writePlannerCoordinatorStatusStates(host, status, diag);
	try {
		const { configureAuthorizationSession, getAuthorizationSession } = await import(
			"../planner_authorization/runtime_session.js"
		);
		const jobActive = Boolean(status.activeJobId);
		const pending = status.rerunPending === true;
		configureAuthorizationSession({
			plannerJobActive: jobActive,
			pendingRerun: pending,
		});
		const auth = getAuthorizationSession().service;
		if (auth && (jobActive || pending)) {
			await auth.invalidate(jobActive ? "planner_job_active" : "pending_rerun");
		}
	} catch {
		// optional
	}
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
		await setOptionalNumberIfChanged(host, PLANNER_COORDINATOR_STATE_IDS.lastCoalescedCount, req.coalescedCount);
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
	try {
		const { getAuthorizationSession } = await import("../planner_authorization/runtime_session.js");
		const auth = getAuthorizationSession().service;
		if (auth) await auth.invalidate("planner_trigger");
	} catch {
		// optional
	}
}

export async function initPlannerShadowRuntime(host: PlannerShadowRuntimeHost): Promise<void> {
	runtimeHost = host;
	unloadStopped = false;

	const parsed = plannerRuntimeModeFromConfig(host.config);
	configuredMode = parsed.mode;
	if (parsed.clamped) {
		host.log.warn(`planner_runtime_mode invalid — clamped to off (raw=${String(parsed.raw)})`);
	}

	const evalParsed = plannerTakeoverEvaluationModeFromConfig(host.config);
	configuredEvaluationMode = evalParsed.mode;
	if (evalParsed.clamped) {
		host.log.warn(
			`planner_takeover_evaluation_mode invalid — clamped to disabled (raw=${String(evalParsed.raw)})`,
		);
	}

	// Discard any persisted session grant; arm only from native mode.
	sessionShadowEnabled = initialSessionShadowFromNative(configuredMode);

	// Central EMS paths — never call a non-existent adapter.getAbsoluteInstanceDataDir().
	const layout = resolvePlannerPaths(host.pathInput ?? host);
	const effectiveMode = resolveEffectivePlannerMode({
		config: { planner_runtime_mode: configuredMode },
		sessionShadowEnabled,
	}).effectiveMode;
	configureDualRunSession({
		layout,
		plannerRuntimeMode: effectiveMode,
		configuredEvaluationMode,
		stateHost: host,
		shuttingDown: false,
	});

	if (effectiveMode !== "off") {
		const { ensurePlannerCoordinatorStates } = await import("./ensure_states.js");
		await ensurePlannerCoordinatorStates(host, { minimal: false });
		const { ensurePlannerTakeoverStates } = await import("../planner_takeover/states.js");
		await ensurePlannerTakeoverStates(host);
	}
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

	if (effectiveMode !== "off") {
		const { initPlannerAuthorizationRuntime } = await import("../planner_authorization/runtime.js");
		await initPlannerAuthorizationRuntime(host);

		const { initPlannerAuthorityRuntime } = await import("../planner_authority/runtime.js");
		await initPlannerAuthorityRuntime(host);
		authAuthorityRuntimesStarted = true;
	}
}

export async function stopPlannerShadowRuntime(): Promise<void> {
	unloadStopped = true;
	configureDualRunSession({ shuttingDown: true });
	if (authAuthorityRuntimesStarted) {
		try {
			// Authority first — revoke worker authority back to legacy before authorization stops.
			const { stopPlannerAuthorityRuntime } = await import("../planner_authority/runtime.js");
			await stopPlannerAuthorityRuntime();
		} catch {
			// optional
		}
		try {
			const { stopPlannerAuthorizationRuntime } = await import("../planner_authorization/runtime.js");
			await stopPlannerAuthorizationRuntime();
		} catch {
			// optional
		}
		authAuthorityRuntimesStarted = false;
	}
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
	configureDualRunSession({ stateHost: null, plannerRuntimeMode: "off" });
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
	if (isPlannerTakeoverStateId(relativeId)) return false;
	return triggerSystem.observeStateChange(relativeId, ack);
}

export async function handlePlannerShadowStateChange(
	host: PlannerShadowRuntimeHost,
	relativeId: string,
	val: unknown,
	ack: boolean | undefined,
): Promise<boolean> {
	if (relativeId.startsWith("planner.takeover.authorization.")) {
		const { handlePlannerAuthorizationRuntimeStateChange } = await import(
			"../planner_authorization/runtime.js"
		);
		return handlePlannerAuthorizationRuntimeStateChange(host, relativeId, val, ack);
	}
	if (
		relativeId.startsWith("planner.authority.") ||
		relativeId === "planner.takeover.activate_worker_dryrun" ||
		relativeId === "planner.takeover.deactivate_worker"
	) {
		const { handlePlannerAuthorityRuntimeStateChange } = await import(
			"../planner_authority/runtime.js"
		);
		return handlePlannerAuthorityRuntimeStateChange(host, relativeId, val, ack);
	}
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
