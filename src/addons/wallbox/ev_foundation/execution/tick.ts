/**
 * One EV-execution tick: desired → authority → gates → machine → optional button write.
 */

import { isRestoreInProgress } from "../../../../restore/barrier";
import { isLiveWriteAllowed, parseAddonMode, parseGlobalMode } from "../../../../execution_mode";
import { addonEnabled, addonMode, GLOBAL } from "../../../../tree_paths";
import { setStateIfChanged } from "../../../../policy/core/state_write";
import type { StateHost } from "../../../../ems_light/state_util";
import type { DeviceWriteHost } from "../../../../device_write";
import { wallboxEvccTelemetryConfigFromAdapter } from "../../evcc_config";
import { resolveEvccModeControlContract } from "../../evcc_mode_control";
import { normalizeEvccFeedbackMode } from "../../runtime/evcc_button_trigger";
import type { EvccTelemetrySnapshot } from "../../evcc_telemetry";
import type { WallboxPlanDecision } from "../../runtime/daily_plan";
import type { WallboxDispatchIntent } from "../../runtime/intent";
import type { EvModelV1 } from "../types";
import { externalControlExpected } from "../decision/authority";
import { EV_EXECUTION_PHASE5_ENABLED } from "../write_allowlist";
import { WALLBOX_EV_FOUNDATION_STATES } from "../ensure_states";
import { stabilizeExecutionAuthority } from "./authority";
import { projectDesiredEvccMode } from "./desired_mode";
import { evaluateEvccSourceFreshness, maxFiniteTs } from "./freshness";
import { evaluateEvExecutionGates, formatEvExecutionExplain } from "./gates";
import { stepEvExecution } from "./machine";
import { dropExecutionOwnership, resolveDesiredWithOwnership } from "./ownership";
import {
	applyEvLiveTestOperatorInputs,
	consumeEvLiveTest,
	emptyEvLiveTestState,
	evaluateEvLiveTestPermit,
	markEvLiveTestResult,
	type EvLiveTestState,
} from "./live_test";
import {
	emptyEvExecutionSession,
	type EvExecutionDesired,
	type EvExecutionMode,
	type EvExecutionSession,
} from "./types";
import { executeEvccButtonWrite } from "./write";

export type EvExecutionTickHost = StateHost & {
	config?: unknown;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	setForeignStateAsync?: DeviceWriteHost["setForeignStateAsync"];
	log?: Pick<ioBroker.Logger, "info" | "warn" | "error" | "debug">;
};

let session: EvExecutionSession = emptyEvExecutionSession();
let liveTest: EvLiveTestState = emptyEvLiveTestState();
let booted = false;

export function resetEvExecutionSession(): void {
	session = emptyEvExecutionSession();
	liveTest = emptyEvLiveTestState();
	booted = false;
}

/** Test helper — never used to reconstruct ownership after a real restart. */
export function replaceEvExecutionSession(next: EvExecutionSession): void {
	session = next;
}

export function replaceEvLiveTestState(next: EvLiveTestState): void {
	liveTest = next;
}

export function peekEvExecutionSession(): EvExecutionSession {
	return session;
}

export function peekEvLiveTestState(): EvLiveTestState {
	return liveTest;
}

function isoOrEmpty(ms: number | null): string {
	if (ms == null || !Number.isFinite(ms)) return "";
	return new Date(ms).toISOString();
}

async function publishSession(
	host: StateHost,
	s: EvExecutionSession,
	extra: {
		enabled: boolean;
		ready: boolean;
		desired: EvExecutionDesired | null;
		actual: EvExecutionMode | null;
	},
): Promise<void> {
	const st = WALLBOX_EV_FOUNDATION_STATES;
	await setStateIfChanged(host, st.evExecutionEnabled, extra.enabled);
	await setStateIfChanged(host, st.evExecutionAuthority, s.authority);
	await setStateIfChanged(host, st.evExecutionReady, extra.ready);
	await setStateIfChanged(host, st.evExecutionBlockReason, s.blockReason);
	await setStateIfChanged(host, st.evExecutionDesiredMode, extra.desired ?? "");
	await setStateIfChanged(host, st.evExecutionDesiredReason, s.desiredReason);
	await setStateIfChanged(host, st.evExecutionActualMode, extra.actual ?? "");
	await setStateIfChanged(host, st.evExecutionSourceFresh, s.sourceFresh);
	await setStateIfChanged(host, st.evExecutionOwnership, s.ownership);
	await setStateIfChanged(host, st.evExecutionOwnedMode, s.ownedMode ?? "");
	await setStateIfChanged(host, st.evExecutionOwnedSince, isoOrEmpty(s.ownedSinceMs));
	await setStateIfChanged(host, st.evExecutionReleaseReason, s.releaseReason);
	await setStateIfChanged(host, st.evExecutionPendingMode, s.pendingMode ?? "");
	await setStateIfChanged(host, st.evExecutionPendingSince, isoOrEmpty(s.pendingSinceMs));
	await setStateIfChanged(host, st.evExecutionLastCommand, s.lastCommand ?? "");
	await setStateIfChanged(host, st.evExecutionLastCommandAt, isoOrEmpty(s.lastCommandAtMs));
	await setStateIfChanged(host, st.evExecutionLastFeedbackAt, isoOrEmpty(s.lastFeedbackAtMs));
	await setStateIfChanged(host, st.evExecutionRetryCount, s.retryCount);
	await setStateIfChanged(host, st.evExecutionLastResult, s.lastResult);
	await setStateIfChanged(host, st.evExecutionFailsafeReason, s.failsafeReason);
	await setStateIfChanged(host, st.evExecutionPhase, s.phase);
	await setStateIfChanged(host, st.evExecutionExplain, s.explain);
	await setStateIfChanged(host, st.evExecutionLiveTestConsumed, liveTest.consumed);
	await setStateIfChanged(host, st.evExecutionLiveTestArmedAt, isoOrEmpty(liveTest.armedAtMs));
	await setStateIfChanged(host, st.evExecutionLiveTestConsumedAt, isoOrEmpty(liveTest.consumedAtMs));
	await setStateIfChanged(host, st.evExecutionLiveTestCommand, liveTest.command ?? "");
	await setStateIfChanged(host, st.evExecutionLiveTestResult, liveTest.result);
	await setStateIfChanged(host, st.evExecutionLiveTestBlockReason, liveTest.blockReason);
}

async function readModeFeedback(
	host: EvExecutionTickHost,
	stateId: string,
	snapMode: string | null,
): Promise<{ raw: string | null; tsMs: number | null; missing: boolean; invalid: boolean }> {
	if (!stateId) {
		return { raw: snapMode, tsMs: null, missing: snapMode == null, invalid: false };
	}
	try {
		const st = host.getForeignStateAsync
			? await host.getForeignStateAsync(stateId)
			: await host.getStateAsync(stateId);
		if (!st || st.val === undefined || st.val === null || String(st.val).trim() === "") {
			return { raw: snapMode, tsMs: typeof st?.ts === "number" ? st.ts : null, missing: snapMode == null, invalid: false };
		}
		const raw = String(st.val);
		const tsMs = typeof st.ts === "number" && Number.isFinite(st.ts) ? st.ts : typeof st.lc === "number" ? st.lc : null;
		const normalized = normalizeEvccFeedbackMode(raw);
		return { raw, tsMs, missing: false, invalid: normalized == null };
	} catch {
		return { raw: snapMode, tsMs: null, missing: snapMode == null, invalid: false };
	}
}

async function readStateTs(host: EvExecutionTickHost, stateId: string): Promise<number | null> {
	if (!stateId) return null;
	try {
		const st = host.getForeignStateAsync
			? await host.getForeignStateAsync(stateId)
			: await host.getStateAsync(stateId);
		if (!st) return null;
		if (typeof st.ts === "number" && Number.isFinite(st.ts)) return st.ts;
		if (typeof st.lc === "number" && Number.isFinite(st.lc)) return st.lc;
		return null;
	} catch {
		return null;
	}
}

export interface EvExecutionTickInput {
	nowMs: number;
	snap: EvccTelemetrySnapshot;
	model: EvModelV1;
	planDecision: WallboxPlanDecision;
	intent: WallboxDispatchIntent;
	faultActive: boolean;
	addonEnabled: boolean;
	governanceEnabled: boolean;
}

export async function tickEvExecution(host: EvExecutionTickHost, input: EvExecutionTickInput): Promise<EvExecutionSession> {
	const nowMs = input.nowMs;
	const contract = resolveEvccModeControlContract(host.config ?? {});
	const projection = projectDesiredEvccMode({
		intentAction: input.intent.action,
		energySource: input.intent.source !== "none" ? input.intent.source : input.planDecision.energySource,
		chargingAllowed: input.planDecision.chargingAllowedByPlan,
		allocatedPowerW: input.planDecision.allocatedPowerW,
		dailyPlanStatus: input.planDecision.dailyPlanStatus,
		decisionSource: input.planDecision.decisionSource,
		planValid: input.planDecision.planValid,
		useDailyPlan: input.planDecision.useDailyPlan,
		vehicleConnected: input.planDecision.connected,
	});
	const snapMode = input.snap.loadpoint_mode.status === "valid" ? input.snap.loadpoint_mode.value : null;
	const fb = await readModeFeedback(host, contract.modeFeedbackStateId, snapMode);
	const actual = normalizeEvccFeedbackMode(fb.raw);

	const telCfg = wallboxEvccTelemetryConfigFromAdapter(host.config ?? {});
	const heartbeatIds = [
		telCfg.chargePowerWStateId,
		telCfg.chargingStateId,
		telCfg.connectedStateId,
		telCfg.offeredCurrentAStateId,
	].filter((id) => id.length > 0);
	const heartbeatTs = maxFiniteTs(await Promise.all(heartbeatIds.map((id) => readStateTs(host, id))));
	const source = evaluateEvccSourceFreshness({
		connectionValue: input.snap.connection.status === "valid" ? input.snap.connection.value : null,
		connectionKnown: input.snap.connection.status === "valid",
		heartbeatTsMs: heartbeatTs,
		heartbeatConfigured: heartbeatIds.length > 0,
		nowMs,
	});

	const globalSt = await host.getStateAsync(GLOBAL.executionMode);
	const addonModeSt = await host.getStateAsync(addonMode("wallbox"));
	const addonEnSt = await host.getStateAsync(addonEnabled("wallbox"));
	const globalLive = parseGlobalMode(globalSt?.val) === "live";
	const addonLive = parseAddonMode(addonModeSt?.val) === "live";
	const addonEnabledVal = addonEnSt?.val !== false && input.addonEnabled;
	const liveAllowed = await isLiveWriteAllowed((id) => host.getStateAsync(id), "wallbox");

	const stIds = WALLBOX_EV_FOUNDATION_STATES;
	if (!booted) {
		liveTest = emptyEvLiveTestState();
		await host.setStateAsync(stIds.evExecutionLiveTestArmed, { val: false, ack: true });
		await host.setStateAsync(stIds.evExecutionLiveTestDisarm, { val: false, ack: true });
	} else {
		const armSt = await host.getStateAsync(stIds.evExecutionLiveTestArmed);
		const disarmSt = await host.getStateAsync(stIds.evExecutionLiveTestDisarm);
		const before = liveTest;
		liveTest = applyEvLiveTestOperatorInputs({
			prev: liveTest,
			armedVal: armSt?.val,
			armedAck: armSt?.ack,
			disarmVal: disarmSt?.val,
			nowMs,
		});
		if (disarmSt?.val === true) {
			await host.setStateAsync(stIds.evExecutionLiveTestDisarm, { val: false, ack: true });
		}
		if (armSt?.val === true && armSt.ack === false && liveTest.armed) {
			await host.setStateAsync(stIds.evExecutionLiveTestArmed, { val: true, ack: true });
		} else if (armSt?.val === false && armSt.ack === false) {
			await host.setStateAsync(stIds.evExecutionLiveTestArmed, { val: false, ack: true });
		} else if (before.armed && !liveTest.armed && !liveTest.consumed) {
			await host.setStateAsync(stIds.evExecutionLiveTestArmed, { val: false, ack: true });
		}
	}

	const stabilized = stabilizeExecutionAuthority({
		raw: input.model.externalAuthorityState,
		externalExpected: externalControlExpected(input.model),
		prevAuthority: session.authority,
		lastExternalHoldAtMs: session.lastExternalHoldAtMs,
		lastInactiveSinceMs: session.lastInactiveSinceMs,
		nowMs,
	});

	session = {
		...session,
		authority: stabilized.authority,
		lastExternalHoldAtMs: stabilized.lastExternalHoldAtMs,
		lastInactiveSinceMs: stabilized.lastInactiveSinceMs,
		sourceFresh: source.fresh,
	};
	session = dropExecutionOwnership(session, {
		authority: stabilized.authority,
		actualMode: actual,
	});

	const resolved = resolveDesiredWithOwnership({
		projection,
		ownership: session.ownership,
		ownedMode: session.ownedMode,
		planValid: input.planDecision.planValid,
		useDailyPlan: input.planDecision.useDailyPlan,
		authority: stabilized.authority,
	});
	const desired = resolved.desired;
	if (resolved.action === "release_off") {
		session.releaseReason = "release_off";
	}
	session.desiredReason = resolved.reason;

	const pendingActive =
		session.pendingMode != null &&
		(session.phase === "command_sent" || session.phase === "awaiting_feedback" || session.phase === "retry");
	const livePermit = evaluateEvLiveTestPermit({
		liveTest,
		desiredMode: desired,
		pendingMode: session.pendingMode,
		pendingActive,
	});
	liveTest = { ...liveTest, blockReason: livePermit.blockReason };

	const gates = evaluateEvExecutionGates({
		featureEnabled: EV_EXECUTION_PHASE5_ENABLED,
		globalLive: globalLive && liveAllowed === true ? true : globalLive,
		addonLive,
		addonEnabled: addonEnabledVal,
		governanceEnabled: input.governanceEnabled,
		authority: stabilized.authority,
		authorityFailsafeReason: stabilized.failsafeReason,
		buttonsReady: contract.buttonsReady,
		resolvedVariant: contract.resolvedVariant,
		desiredMode: desired,
		actualMissing: fb.missing || actual == null,
		actualInvalid: fb.invalid,
		sourceStale: source.reason === "evcc_source_stale",
		sourceOffline: source.reason === "evcc_source_offline",
		faultActive: input.faultActive,
		restoreInProgress: isRestoreInProgress(),
		liveTestPermit: livePermit.permit,
		liveTestBlockReason:
			livePermit.blockReason === "live_test_not_armed" || !livePermit.blockReason
				? "feature_gate"
				: livePermit.blockReason,
	});
	const writeAllowed = gates.writeAllowed && liveAllowed;
	if (!liveTest.consumed && liveTest.armed && !writeAllowed && gates.blockReason) {
		liveTest = { ...liveTest, blockReason: gates.blockReason };
	}

	const stepped = stepEvExecution(session, {
		nowMs,
		desiredMode: desired,
		actualMode: actual,
		writeAllowed,
		blockReason: gates.blockReason,
		failsafeReason: gates.failsafeReason,
		authorityIsEms: stabilized.authority === "ems",
		modeTsMs: fb.tsMs,
		desiredReason: resolved.reason,
		retriesBlocked: liveTest.retriesBlocked,
	});
	session = stepped.session;
	session.sourceFresh = source.fresh;
	session.desiredReason = resolved.reason;
	if (liveTest.consumed) {
		if (session.phase === "confirmed" && session.lastResult === "confirmed") {
			liveTest = markEvLiveTestResult(liveTest, "feedback_confirmed");
		} else if (session.phase === "failsafe" || session.failsafeReason) {
			liveTest = markEvLiveTestResult(liveTest, "feedback_failed");
		} else if (
			session.phase === "awaiting_feedback" ||
			session.phase === "command_sent" ||
			session.phase === "retry"
		) {
			liveTest = markEvLiveTestResult(liveTest, "awaiting_feedback");
		}
	}
	session.explain = formatEvExecutionExplain({
		desired,
		actual,
		authority: session.authority,
		phase: session.phase,
		blockReason: session.blockReason || gates.blockReason,
		failsafeReason: session.failsafeReason || gates.failsafeReason,
		writeAllowed,
		desiredReason: resolved.reason,
		sourceFresh: source.fresh,
		ownership: session.ownership,
		ownedMode: session.ownedMode,
		releaseReason: session.releaseReason,
		action: resolved.action,
		liveTestArmed: liveTest.armed,
		liveTestConsumed: liveTest.consumed,
		liveTestCommand: liveTest.command,
		liveTestResult: liveTest.result,
		lastResult: session.lastResult,
	});
	if (!session.blockReason && gates.blockReason && !writeAllowed && desired !== "noop") {
		session.blockReason = gates.blockReason;
	}

	if (stepped.writeMode && writeAllowed && host.setForeignStateAsync && host.getForeignStateAsync) {
		const writeHost: DeviceWriteHost = {
			getForeignStateAsync: host.getForeignStateAsync,
			setForeignStateAsync: host.setForeignStateAsync,
			log: host.log,
		};
		const wr = await executeEvccButtonWrite(writeHost, {
			contract,
			mode: stepped.writeMode,
			writeAllowed: true,
			liveTestPermit: livePermit.permit,
		});
		if (wr.written && livePermit.consumeOnSuccessfulWrite) {
			liveTest = consumeEvLiveTest(liveTest, stepped.writeMode, nowMs);
			await host.setStateAsync(stIds.evExecutionLiveTestArmed, { val: false, ack: true });
			liveTest = markEvLiveTestResult(liveTest, "awaiting_feedback");
			session.explain = formatEvExecutionExplain({
				desired,
				actual,
				authority: session.authority,
				phase: session.phase,
				blockReason: session.blockReason || gates.blockReason,
				failsafeReason: session.failsafeReason || gates.failsafeReason,
				writeAllowed,
				desiredReason: resolved.reason,
				sourceFresh: source.fresh,
				ownership: session.ownership,
				ownedMode: session.ownedMode,
				releaseReason: session.releaseReason,
				action: resolved.action,
				liveTestArmed: liveTest.armed,
				liveTestConsumed: liveTest.consumed,
				liveTestCommand: liveTest.command,
				liveTestResult: liveTest.result,
				lastResult: session.lastResult,
			});
		} else if (wr.blocked || !wr.written) {
			session.lastResult = wr.reason;
			if (wr.reason === "feature_gate" || wr.reason === "write_not_allowed") {
				session.blockReason = wr.reason;
			}
		}
	}

	booted = true;
	await publishSession(host, session, {
		enabled: EV_EXECUTION_PHASE5_ENABLED,
		ready: gates.ready,
		desired,
		actual,
	});
	return session;
}

export function evExecutionBooted(): boolean {
	return booted;
}
