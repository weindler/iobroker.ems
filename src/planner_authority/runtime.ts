/**
 * Authority runtime wiring — lazy service creation on first conscious activate.
 */

import { randomUUID } from "node:crypto";
import type { StateHost } from "../ems_light/state_util";
import {
	plannerRequestedAuthorityFromConfig,
	type PlannerRequestedAuthority,
} from "../planner_config/authoritative_source";
import { resolvePlannerPaths } from "../planner_paths/paths";
import { handlePlannerAuthorityStateChange, isPlannerAuthorityActionState } from "./action_bridge";
import { configureAuthoritySession, getAuthoritySession } from "./runtime_session";
import {
	ensurePlannerAuthorityStates,
	isPlannerAuthorityState,
	PLANNER_AUTHORITY_STATE_IDS,
	writePlannerAuthorityStates,
} from "./states";
import type { PlannerAuthorityService } from "./service";

export type AuthorityRuntimeHost = StateHost & {
	namespace: string;
	config?: unknown;
	log?: Pick<ioBroker.Logger, "debug" | "info" | "warn" | "error">;
	/** Test/injection only — production resolves via adapter-core. */
	durableDataDir?: string;
	pathInput?: import("../backup_integration/paths").PathResolverInput;
	subscribeStatesAsync?: (pattern: string) => Promise<void>;
	unsubscribeStatesAsync?: (pattern: string) => Promise<void>;
};

const AUTHORITY_BUTTON_PATTERNS = [
	PLANNER_AUTHORITY_STATE_IDS.activateWorkerDryrun,
	PLANNER_AUTHORITY_STATE_IDS.deactivateWorker,
];

let hostRef: AuthorityRuntimeHost | null = null;
let configuredSource: PlannerRequestedAuthority = "legacy";
let stopped = false;

async function requestLegacyRun(reason: string): Promise<void> {
	try {
		const { getPlannerOnDemandCoordinator } = await import("../planner_coordinator/compose.js");
		const coordinator = getPlannerOnDemandCoordinator();
		if (coordinator) {
			await coordinator.request({ reason: "manual", requestedAt: new Date().toISOString(), force: true });
		}
		hostRef?.log?.debug?.(`planner authority legacy fallback requested (${reason})`);
	} catch {
		// optional
	}
}

async function ensureService(): Promise<PlannerAuthorityService | null> {
	const sess = getAuthoritySession();
	if (sess.service) return sess.service;
	if (configuredSource !== "worker_dryrun") return null;
	const host = hostRef;
	if (!host) return null;

	const { PlannerAuthorityService } = await import("./service.js");
	const { policyFingerprint } = await import("../planner_takeover/evidence.js");
	const { DEFAULT_TAKEOVER_READINESS_POLICY } = await import("../planner_takeover/constants.js");
	const { getAuthorizationSession } = await import("../planner_authorization/runtime_session.js");

	const layout = sess.layout ?? resolvePlannerPaths(host.pathInput ?? host);

	const service = new PlannerAuthorityService({
		now: () => new Date(),
		adapterInstance: host.namespace,
		sessionId: sess.sessionId || randomUUID(),
		layout,
		getConfiguredSource: () => configuredSource,
		getRuntimeMode: () => getAuthoritySession().runtimeMode,
		getEvaluationMode: () => getAuthoritySession().evaluationMode,
		getExecutionMode: () => getAuthoritySession().executionMode,
		getEvidence: () => getAuthoritySession().evidence,
		getExpectedPolicyFingerprint: () => policyFingerprint(DEFAULT_TAKEOVER_READINESS_POLICY),
		getBoundRevisions: () => getAuthoritySession().bound,
		getCandidate: () => getAuthoritySession().candidate,
		peekAuthorizationGrant: () => getAuthorizationSession().service?.peekGrant() ?? null,
		consumeAuthorizationGrant: () =>
			getAuthorizationSession().service?.consumeGrantForActivation() ?? null,
		requestLegacyRun,
		getStateHost: () => hostRef,
		onStatus: (status) => {
			if (!hostRef || stopped) return;
			void writePlannerAuthorityStates(hostRef, status).catch(() => undefined);
		},
	});
	configureAuthoritySession({ service, layout });
	return service;
}

export async function notifyPlannerAuthorityExecutionMode(mode: string): Promise<void> {
	if (stopped) return;
	const normalized = mode === "dryrun" ? "dryrun" : mode === "live" ? "live" : String(mode || "dryrun");
	configureAuthoritySession({ executionMode: normalized });
	const service = getAuthoritySession().service;
	if (service) await service.onExecutionModeChange(normalized).catch(() => undefined);
}

export async function recordPlannerAuthorityWorkerMemory(memory: {
	rssBeforeWorkerJobMib: number;
	rssAfterWorkerExitMib: number;
	lastWorkerDeltaMib: number;
	legacyModuleLoaded: boolean;
}): Promise<void> {
	if (!hostRef || stopped) return;
	const { writePlannerAuthorityMemoryStates } = await import("./states.js");
	await writePlannerAuthorityMemoryStates(hostRef, memory);
}

export async function initPlannerAuthorityRuntime(host: AuthorityRuntimeHost): Promise<void> {
	hostRef = host;
	stopped = false;
	const parsed = plannerRequestedAuthorityFromConfig(host.config);
	configuredSource = parsed.mode;
	if (parsed.clamped) {
		host.log?.warn?.(
			`planner_authoritative_source invalid — clamped to legacy (raw=${String(parsed.raw)})`,
		);
	}
	const layout = resolvePlannerPaths(host.pathInput ?? host);
	configureAuthoritySession({
		configuredSource,
		layout,
		sessionId: randomUUID(),
		shuttingDown: false,
		adapterReady: true,
		executionMode:
			(host.config as { global_execution_mode?: string } | undefined)?.global_execution_mode === "live"
				? "live"
				: "dryrun",
	});

	// Objects must exist before any state write (cold-start / empty namespace).
	await ensurePlannerAuthorityStates(host);

	await setStateIfChangedSafe(host, PLANNER_AUTHORITY_STATE_IDS.configuredSource, configuredSource);
	// No automatic activation on startup — effective is always legacy or worker_pending.
	await setStateIfChangedSafe(
		host,
		PLANNER_AUTHORITY_STATE_IDS.effectiveAuthority,
		configuredSource === "worker_dryrun" ? "worker_pending" : "legacy",
	);
	await setStateIfChangedSafe(host, PLANNER_AUTHORITY_STATE_IDS.workerAuthoritative, false);
	await setStateIfChangedSafe(host, PLANNER_AUTHORITY_STATE_IDS.canonicalAllowed, false);

	if (configuredSource === "worker_dryrun" && typeof host.subscribeStatesAsync === "function") {
		for (const p of AUTHORITY_BUTTON_PATTERNS) {
			await host.subscribeStatesAsync(p);
		}
	}
}

export async function stopPlannerAuthorityRuntime(): Promise<void> {
	stopped = true;
	configureAuthoritySession({ shuttingDown: true });
	const service = getAuthoritySession().service;
	if (service) {
		await service.shutdown().catch(() => undefined);
	}
	configureAuthoritySession({ service: null });
	const host = hostRef;
	if (host && typeof host.unsubscribeStatesAsync === "function") {
		for (const p of AUTHORITY_BUTTON_PATTERNS) {
			await host.unsubscribeStatesAsync(p).catch(() => undefined);
		}
	}
	hostRef = null;
}

export async function handlePlannerAuthorityRuntimeStateChange(
	host: AuthorityRuntimeHost,
	relativeId: string,
	val: unknown,
	ack: boolean | undefined,
): Promise<boolean> {
	if (!isPlannerAuthorityActionState(relativeId) && !isPlannerAuthorityState(relativeId)) return false;
	if (stopped) return true;

	return handlePlannerAuthorityStateChange(host, relativeId, val, ack, {
		activateWorkerDryrun: async () => {
			const service = await ensureService();
			if (!service) return;
			await service.activateWorkerDryrun();
		},
		deactivateWorker: async () => {
			const service = getAuthoritySession().service ?? (await ensureService());
			if (!service) return;
			await service.deactivateWorker();
		},
	});
}

async function setStateIfChangedSafe(host: StateHost, id: string, val: ioBroker.StateValue): Promise<void> {
	const cur = await host.getStateAsync(id);
	if (cur?.val === val && cur?.ack === true) return;
	await host.setStateAsync(id, { val, ack: true });
}

export function getConfiguredAuthoritativeSourceForTest(): string {
	return configuredSource;
}
