/**
 * Authorization runtime wiring — lazy service creation on first prepare when eligible.
 */

import { randomUUID } from "node:crypto";
import type { StateHost } from "../ems_light/state_util";
import {
	plannerTakeoverAuthorizationModeFromConfig,
	type PlannerTakeoverAuthorizationMode,
} from "../planner_config/authorization_mode";
import { resolvePlannerPaths } from "../planner_paths/paths";
import { handlePlannerAuthorizationStateChange } from "./action_bridge";
import {
	configureAuthorizationSession,
	getAuthorizationSession,
} from "./runtime_session";
import {
	ensurePlannerAuthorizationStates,
	isPlannerAuthorizationState,
	PLANNER_AUTHORIZATION_STATE_IDS,
	writePlannerAuthorizationStates,
} from "./states";
import type { PlannerAuthorizationService } from "./service";

export type AuthorizationRuntimeHost = StateHost & {
	namespace: string;
	config?: unknown;
	log?: Pick<ioBroker.Logger, "debug" | "info" | "warn" | "error">;
	/** Test/injection only — production resolves via adapter-core. */
	durableDataDir?: string;
	pathInput?: import("../backup_integration/paths").PathResolverInput;
	subscribeStatesAsync?: (pattern: string) => Promise<void>;
	unsubscribeStatesAsync?: (pattern: string) => Promise<void>;
};

const AUTH_BUTTON_PATTERNS = [
	PLANNER_AUTHORIZATION_STATE_IDS.prepare,
	PLANNER_AUTHORIZATION_STATE_IDS.confirm,
	PLANNER_AUTHORIZATION_STATE_IDS.cancel,
	PLANNER_AUTHORIZATION_STATE_IDS.confirmChallengeId,
];

let hostRef: AuthorizationRuntimeHost | null = null;
let configuredAuthMode: PlannerTakeoverAuthorizationMode = "disabled";
let stopped = false;

async function ensureService(): Promise<PlannerAuthorizationService | null> {
	const sess = getAuthorizationSession();
	if (sess.service) return sess.service;
	if (configuredAuthMode !== "manual_prepare") return null;
	if (sess.runtimeMode !== "shadow_auto" || sess.evaluationMode !== "observe") return null;

	const { PlannerAuthorizationService } = await import("./service.js");
	const host = hostRef;
	if (!host) return null;
	const layout = resolvePlannerPaths(host.pathInput ?? host);
	const service = new PlannerAuthorizationService({
		now: () => new Date(),
		adapterInstance: host.namespace,
		sessionId: sess.sessionId || randomUUID(),
		auditDir: layout.runtimeTakeoverDir,
		getRuntimeMode: () => getAuthorizationSession().runtimeMode,
		getEvaluationMode: () => getAuthorizationSession().evaluationMode,
		getAuthorizationMode: () => configuredAuthMode,
		getEvidence: () => getAuthorizationSession().evidence,
		getEligibilityExtras: () => {
			const s = getAuthorizationSession();
			return {
				adapterReady: s.adapterReady,
				shuttingDown: s.shuttingDown,
				restoreBarrierActive: s.restoreBarrierActive,
				operationLockActive: s.operationLockActive,
				lastCompareStatus: s.lastCompareStatus,
				authoritativeRevision: s.bound?.authoritativeRevision ?? null,
				candidateRevision: s.bound?.candidateRevision ?? null,
				inputRevision: s.bound?.inputRevision ?? null,
				generationMatches: s.bound != null,
				horizonMatches: s.bound != null,
				candidateValid: s.candidateValid,
				authoritativePublishOk: s.authoritativePublishOk,
				plannerJobActive: s.plannerJobActive,
				pendingRerun: s.pendingRerun,
				executionMode: s.executionMode,
				bound: s.bound,
				dryrunPilotReady: s.dryrunPilotReady === true,
			};
		},
		onStatus: (status) => {
			if (!hostRef || stopped) return;
			void writePlannerAuthorizationStates(hostRef, status).catch(() => undefined);
		},
	});
	configureAuthorizationSession({ service });
	await service.syncFromConfig();
	return service;
}

export async function notifyPlannerAuthorizationExecutionMode(mode: string): Promise<void> {
	if (stopped) return;
	try {
		const { configureAuthorizationSession, getAuthorizationSession } = await import("./runtime_session.js");
		const prev = getAuthorizationSession().executionMode;
		configureAuthorizationSession({ executionMode: mode === "live" ? "live" : "dryrun" });
		if (prev !== mode && getAuthorizationSession().service) {
			await getAuthorizationSession().service!.invalidate("execution_mode_change");
		}
	} catch {
		// optional
	}
}

export async function initPlannerAuthorizationRuntime(host: AuthorizationRuntimeHost): Promise<void> {
	hostRef = host;
	stopped = false;
	const parsed = plannerTakeoverAuthorizationModeFromConfig(host.config);
	configuredAuthMode = parsed.mode;
	if (parsed.clamped) {
		host.log?.warn?.(
			`planner_takeover_authorization_mode invalid — clamped to disabled (raw=${String(parsed.raw)})`,
		);
	}
	configureAuthorizationSession({
		authorizationMode: configuredAuthMode,
		sessionId: randomUUID(),
		shuttingDown: false,
		adapterReady: true,
		executionMode:
			(host.config as { global_execution_mode?: string } | undefined)?.global_execution_mode === "live"
				? "live"
				: "dryrun",
	});

	// Objects must exist before any state write (cold-start / empty namespace).
	await ensurePlannerAuthorizationStates(host);

	await setStateIfChangedSafe(host, PLANNER_AUTHORIZATION_STATE_IDS.configuredMode, configuredAuthMode);
	await setStateIfChangedSafe(host, PLANNER_AUTHORIZATION_STATE_IDS.effectiveMode, "disabled");
	await setStateIfChangedSafe(host, PLANNER_AUTHORIZATION_STATE_IDS.activationCapabilityPresent, false);
	await setStateIfChangedSafe(host, PLANNER_AUTHORIZATION_STATE_IDS.permitMinted, false);
	await setStateIfChangedSafe(host, PLANNER_AUTHORIZATION_STATE_IDS.canonicalAllowed, false);

	if (configuredAuthMode === "manual_prepare" && typeof host.subscribeStatesAsync === "function") {
		for (const p of AUTH_BUTTON_PATTERNS) {
			await host.subscribeStatesAsync(p);
		}
	}
}

export async function stopPlannerAuthorizationRuntime(): Promise<void> {
	stopped = true;
	configureAuthorizationSession({ shuttingDown: true });
	const service = getAuthorizationSession().service;
	if (service) {
		await service.shutdown().catch(() => undefined);
	}
	configureAuthorizationSession({ service: null });
	const host = hostRef;
	if (host && typeof host.unsubscribeStatesAsync === "function") {
		for (const p of AUTH_BUTTON_PATTERNS) {
			await host.unsubscribeStatesAsync(p).catch(() => undefined);
		}
	}
	hostRef = null;
}

export async function handlePlannerAuthorizationRuntimeStateChange(
	host: AuthorizationRuntimeHost,
	relativeId: string,
	val: unknown,
	ack: boolean | undefined,
): Promise<boolean> {
	if (!isPlannerAuthorizationState(relativeId)) return false;
	if (stopped) return true;

	return handlePlannerAuthorizationStateChange(host, relativeId, val, ack, {
		prepare: async () => {
			const service = await ensureService();
			if (!service) return;
			await service.prepare();
		},
		confirm: async (challengeId) => {
			const service = getAuthorizationSession().service;
			if (!service) return;
			await service.confirm(challengeId);
		},
		cancel: async () => {
			const service = getAuthorizationSession().service;
			if (!service) return;
			await service.cancel();
		},
		getConfirmChallengeId: async () => {
			const st = await host.getStateAsync(PLANNER_AUTHORIZATION_STATE_IDS.confirmChallengeId);
			return st?.val != null ? String(st.val) : "";
		},
	});
}

async function setStateIfChangedSafe(host: StateHost, id: string, val: ioBroker.StateValue): Promise<void> {
	const cur = await host.getStateAsync(id);
	if (cur?.val === val && cur?.ack === true) return;
	await host.setStateAsync(id, { val, ack: true });
}

export function getConfiguredAuthorizationModeForTest(): string {
	return configuredAuthMode;
}
