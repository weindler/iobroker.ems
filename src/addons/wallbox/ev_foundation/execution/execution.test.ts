import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { addonEnabled, addonMode, GLOBAL } from "../../../../tree_paths";
import { emptyEvccTelemetrySnapshot } from "../../evcc_telemetry";
import { resolveEvccModeControlContract } from "../../evcc_mode_control";
import type { WallboxPlanDecision } from "../../runtime/daily_plan";
import type { WallboxDispatchIntent } from "../../runtime/intent";
import type { EvModelV1 } from "../types";
import {
	EV_EXECUTION_PHASE5_ENABLED,
	EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED,
} from "../write_allowlist";
import { WALLBOX_EV_FOUNDATION_STATES } from "../ensure_states";
import {
	EV_AUTHORITY_HOLD_MS,
	EV_FEEDBACK_TIMEOUT_MS,
	EV_MAX_RETRIES,
	buttonStateId,
	emptyEvExecutionSession,
	evaluateEvccSourceFreshness,
	evaluateEvExecutionGates,
	executeEvccButtonWrite,
	formatEvExecutionExplain,
	isAllowedEvccButtonWriteTarget,
	isCommandFeedbackConfirmed,
	isEvccModeFeedbackStale,
	projectDesiredEvccMode,
	replaceEvExecutionSession,
	replaceEvLiveTestState,
	resetEvExecutionSession,
	resolveDesiredWithOwnership,
	shouldReleaseOwnedCharge,
	stabilizeExecutionAuthority,
	stepEvExecution,
	tickEvExecution,
	dropExecutionOwnership,
	emptyEvLiveTestState,
	evaluateEvLiveTestPermit,
	armEvLiveTest,
	consumeEvLiveTest,
	disarmEvLiveTest,
	peekEvExecutionSession,
	peekEvLiveTestState,
	type EvExecutionSession,
	type EvExecutionTickHost,
} from "./index";

const SRC = join(__dirname, "..", "..", "..", "..", "..", "src", "addons", "wallbox");
const LP = "evcc.0.loadpoint.1";
const NOW = Date.parse("2026-08-15T08:00:00.000Z");

const BUTTON_CFG = {
	wb_control_model: "evcc",
	wb_evcc_mode_control: "buttons",
	wb_evcc_control_off_target: `${LP}.control.off`,
	wb_evcc_control_pv_target: `${LP}.control.pv`,
	wb_evcc_control_min_target: `${LP}.control.min`,
	wb_evcc_control_now_target: `${LP}.control.now`,
	wb_evcc_loadpoint_mode_state: `${LP}.status.mode`,
	wb_evcc_control_max_current_target: `${LP}.control.maxCurrent`,
	wb_evcc_control_phases_configured_target: `${LP}.control.phasesConfigured`,
};

function model(over: Partial<EvModelV1> = {}): EvModelV1 {
	return {
		evccConnected: true,
		vehicleConnected: true,
		charging: false,
		chargePowerW: 0,
		evccMode: "pv",
		phasesConfigured: 3,
		phasesActive: 0,
		maxCurrentA: 16,
		minCurrentA: 6,
		effectiveMaxCurrentA: 16,
		offeredCurrentA: 16,
		vehicleSocPct: 50,
		targetSocPct: 90,
		minimumDepartureSocPct: null,
		departureAt: null,
		batteryCapacityKWh: 77,
		maxAcChargePowerKw: 11,
		chargingEfficiency: 0.9,
		safetyMarginMin: 15,
		vehicleAvailableUntil: null,
		externalControlEnabled: false,
		externalControlType: "none",
		externalControlActive: false,
		externalControlConfigured: false,
		externalSmartPlanAvailable: false,
		externalSmartPlanSlots: null,
		externalPlanRemainingEnergyKWh: null,
		externalPlanRemainingMinutes: null,
		externalPlanDeadlineUsed: false,
		gridRewardsActive: false,
		smartChargingActive: false,
		externalSourceQuality: "unconfigured",
		externalSourceUpdatedAt: null,
		externalSourceHealthy: true,
		manualOverrideActive: null,
		emsTakeoverActive: false,
		preparedEvState: "pv",
		recommendedEvState: "pv",
		externalAuthorityState: "inactive",
		takeoverSeverity: "none",
		takeoverRecommended: false,
		takeoverRequired: false,
		takeoverReason: null,
		vehicleDetectionActive: true,
		dataQuality: "ok",
		vehicleSocQuality: "valid",
		externalSmartChargingMinSocPct: null,
		externalSmartChargingMinSocQuality: "unconfigured",
		departureMinSocConfigured: false,
		vehicleModelSource: "ev_model_v1",
		vehicleModelReady: true,
		controlContractModel: "evcc_buttons",
		evccControlContractReady: true,
		legacyDirectControlPresent: false,
		evccModeControlVariant: "buttons",
		evccModeFeedbackState: `${LP}.status.mode`,
		evccModeButtonsReady: true,
		evccModeOffTargetReady: true,
		evccModePvTargetReady: true,
		evccModeMinTargetReady: true,
		evccModeNowTargetReady: true,
		...over,
	};
}

function decision(over: Partial<WallboxPlanDecision> = {}): WallboxPlanDecision {
	return {
		connected: true,
		planValid: true,
		useDailyPlan: true,
		chargingAllowedByPlan: true,
		dailyPlanStatus: "daily_plan_valid",
		dailyPlanRevision: 1,
		slotStartIso: "2026-08-15T08:00:00.000Z",
		slotEndIso: "2026-08-15T08:15:00.000Z",
		allocatedPowerW: 11000,
		allocatedEnergyKwh: 2.75,
		requestedPowerW: 11000,
		requestedEnergyKwh: 2.75,
		pvPowerW: 0,
		gridPowerW: 11000,
		energySource: "grid",
		deadlineIso: null,
		estimatedCostCt: null,
		remainingEnergyKwh: 10,
		minChargePowerW: 1380,
		maxChargePowerW: 11000,
		plannedEnergyUntilDeadlineKwh: 10,
		plannedPvEnergyUntilDeadlineKwh: 0,
		plannedGridEnergyUntilDeadlineKwh: 10,
		plannedCostUntilDeadlineCt: null,
		deadlineReachable: true,
		firstPlannedSlot: "2026-08-15T08:00:00.000Z",
		lastPlannedSlot: "2026-08-15T08:00:00.000Z",
		activePlannedSlots: 1,
		maxPlannedPowerW: 11000,
		planExecutionStatus: "in_plan",
		decisionSource: "daily_plan",
		reasonDe: "test",
		externalPlanActive: false,
		externalPlanTime: null,
		runtimeControlAvailable: false,
		writeAllowed: false,
		...over,
	};
}

function intent(over: Partial<WallboxDispatchIntent> = {}): WallboxDispatchIntent {
	return {
		action: "charge",
		enabled: true,
		targetPowerW: 11000,
		targetCurrentA: 16,
		phases: 3,
		source: "grid",
		deadlineIso: null,
		requestedEnergyKwh: 2.75,
		allocatedEnergyKwh: 2.75,
		generatedAt: "2026-08-15T08:00:00.000Z",
		validUntil: "2026-08-15T08:15:00.000Z",
		dailyPlanRevision: 1,
		reasonDe: "test",
		...over,
	};
}

function greenGates(over: Parameters<typeof evaluateEvExecutionGates>[0] extends infer T ? Partial<T> : never) {
	return evaluateEvExecutionGates({
		featureEnabled: true,
		globalLive: true,
		addonLive: true,
		addonEnabled: true,
		governanceEnabled: true,
		authority: "ems",
		authorityFailsafeReason: "",
		buttonsReady: true,
		resolvedVariant: "buttons",
		desiredMode: "now",
		actualMissing: false,
		actualInvalid: false,
		sourceStale: false,
		sourceOffline: false,
		faultActive: false,
		restoreInProgress: false,
		...over,
	});
}

function tickHost(opts: {
	global?: string;
	addon?: string;
	addonOn?: boolean;
	foreign?: Record<string, { val: unknown; ts?: number }>;
}): {
	host: EvExecutionTickHost;
	foreignWrites: Array<{ id: string; val: unknown }>;
	foreign: Record<string, { val: unknown; ts?: number }>;
	setLocal: (id: string, val: unknown, ack?: boolean) => void;
} {
	const foreignWrites: Array<{ id: string; val: unknown }> = [];
	const states: Record<string, { val: unknown; ack: boolean; ts: number }> = {
		[GLOBAL.executionMode]: { val: opts.global ?? "dryrun", ack: true, ts: NOW },
		[addonMode("wallbox")]: { val: opts.addon ?? "dryrun", ack: true, ts: NOW },
		[addonEnabled("wallbox")]: { val: opts.addonOn !== false, ack: true, ts: NOW },
	};
	const foreign = { ...(opts.foreign ?? { [`${LP}.status.mode`]: { val: "pv", ts: NOW } }) };
	const host: EvExecutionTickHost = {
		config: BUTTON_CFG,
		async getStateAsync(id) {
			const st = states[id];
			if (!st) return null;
			return { val: st.val, ts: st.ts, ack: st.ack } as ioBroker.State;
		},
		async setStateAsync(id, state) {
			const val = typeof state === "object" && state && "val" in state ? state.val : state;
			const ack = typeof state === "object" && state && "ack" in state ? Boolean(state.ack) : true;
			states[id] = { val, ack, ts: NOW };
		},
		async setObjectNotExistsAsync() {
			return;
		},
		async getForeignStateAsync(id) {
			const st = foreign[id];
			if (!st) return null;
			return { val: st.val, ts: st.ts ?? NOW, ack: true } as ioBroker.State;
		},
		async setForeignStateAsync(id, state) {
			const val = typeof state === "object" && state && "val" in state ? state.val : state;
			foreignWrites.push({ id, val });
		},
		log: { debug() {}, info() {}, warn() {}, error() {} },
	};
	return {
		host,
		foreignWrites,
		foreign,
		setLocal(id, val, ack = true) {
			states[id] = { val, ack, ts: NOW };
		},
	};
}

afterEach(() => {
	resetEvExecutionSession();
});

describe("Phase 5A EV execution foundation", () => {
	it("T3: feature gate defaults false and blocks writes", async () => {
		assert.equal(EV_EXECUTION_PHASE5_ENABLED, false);
		assert.equal(EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
		const writes: string[] = [];
		const r = await executeEvccButtonWrite(
			{
				async getForeignStateAsync() {
					return { val: false } as ioBroker.State;
				},
				async setForeignStateAsync(id) {
					writes.push(id);
				},
			},
			{ contract: resolveEvccModeControlContract(BUTTON_CFG), mode: "now", writeAllowed: true },
		);
		assert.equal(r.written, false);
		assert.equal(r.blocked, true);
		assert.equal(r.reason, "feature_gate");
		assert.equal(writes.length, 0);
	});

	it("T1: global dryrun → no write", async () => {
		const { host, foreignWrites } = tickHost({ global: "dryrun", addon: "live" });
		const snap = emptyEvccTelemetrySnapshot("2026-08-15T08:00:00.000Z");
		snap.loadpoint_mode = { value: "pv", status: "valid", raw: "pv" };
		await tickEvExecution(host, {
			nowMs: NOW,
			snap,
			model: model(),
			planDecision: decision(),
			intent: intent(),
			faultActive: false,
			addonEnabled: true,
			governanceEnabled: true,
		});
		assert.equal(foreignWrites.length, 0);
		assert.match(String((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionExplain))?.val), /write_blocked=global_dryrun|feature_gate/);
	});

	it("T2: global live + addon dryrun → no write", async () => {
		const { host, foreignWrites } = tickHost({ global: "live", addon: "dryrun" });
		const snap = emptyEvccTelemetrySnapshot("2026-08-15T08:00:00.000Z");
		snap.loadpoint_mode = { value: "pv", status: "valid", raw: "pv" };
		await tickEvExecution(host, {
			nowMs: NOW,
			snap,
			model: model(),
			planDecision: decision(),
			intent: intent(),
			faultActive: false,
			addonEnabled: true,
			governanceEnabled: true,
		});
		assert.equal(foreignWrites.length, 0);
		const g = greenGates({ globalLive: true, addonLive: false, featureEnabled: true });
		assert.equal(g.writeAllowed, false);
		assert.equal(g.blockReason, "addon_dryrun");
	});

	it("T4: external/Tibber authority → no EMS write", () => {
		const g = greenGates({ authority: "external" });
		assert.equal(g.writeAllowed, false);
		assert.equal(g.blockReason, "external_authority");
		const s = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "now",
			actualMode: "pv",
			writeAllowed: false,
			blockReason: "external_authority",
			failsafeReason: "",
			authorityIsEms: false,
		});
		assert.equal(s.writeMode, null);
	});

	it("T5: external ends durably → EMS may take over", () => {
		const first = stabilizeExecutionAuthority({
			raw: "active",
			externalExpected: true,
			prevAuthority: "none",
			lastExternalHoldAtMs: null,
			lastInactiveSinceMs: null,
			nowMs: NOW,
		});
		assert.equal(first.authority, "external");
		const later = stabilizeExecutionAuthority({
			raw: "inactive",
			externalExpected: true,
			prevAuthority: "external",
			lastExternalHoldAtMs: first.lastExternalHoldAtMs,
			lastInactiveSinceMs: NOW + 1_000,
			nowMs: NOW + EV_AUTHORITY_HOLD_MS + 60_000,
		});
		assert.equal(later.authority, "ems");
	});

	it("T6: short external flicker → no authority ping-pong", () => {
		const a = stabilizeExecutionAuthority({
			raw: "active",
			externalExpected: true,
			prevAuthority: "none",
			lastExternalHoldAtMs: null,
			lastInactiveSinceMs: null,
			nowMs: NOW,
		});
		const flicker = stabilizeExecutionAuthority({
			raw: "inactive",
			externalExpected: true,
			prevAuthority: "external",
			lastExternalHoldAtMs: a.lastExternalHoldAtMs,
			lastInactiveSinceMs: NOW + 5_000,
			nowMs: NOW + 30_000,
		});
		assert.equal(flicker.authority, "external");
		const back = stabilizeExecutionAuthority({
			raw: "active",
			externalExpected: true,
			prevAuthority: flicker.authority,
			lastExternalHoldAtMs: flicker.lastExternalHoldAtMs,
			lastInactiveSinceMs: flicker.lastInactiveSinceMs,
			nowMs: NOW + 40_000,
		});
		assert.equal(back.authority, "external");
	});

	it("T7: EMS + green gates select the correct EVCC button", () => {
		assert.equal(
			projectDesiredEvccMode({
				intentAction: "charge",
				energySource: "grid",
				chargingAllowed: true,
				allocatedPowerW: 11000,
			}).desired,
			"now",
		);
		const contract = resolveEvccModeControlContract(BUTTON_CFG);
		assert.equal(buttonStateId(contract, "now"), `${LP}.control.now`);
		assert.equal(isAllowedEvccButtonWriteTarget(`${LP}.control.now`, "now"), true);
		const stepped = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "now",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(stepped.writeMode, "now");
	});

	it("T8: status.mode confirms desired → success / no second write", () => {
		const sent = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "now",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(sent.writeMode, "now");
		const confirmed = stepEvExecution(sent.session, {
			nowMs: NOW + 20_000,
			desiredMode: "now",
			actualMode: "now",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(confirmed.session.phase, "confirmed");
		assert.equal(confirmed.writeMode, null);
		assert.equal(confirmed.session.retryCount, 0);
	});

	it("T9: wrong feedback → bounded retry", () => {
		let s = emptyEvExecutionSession();
		const first = stepEvExecution(s, {
			nowMs: NOW,
			desiredMode: "pv",
			actualMode: "off",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(first.writeMode, "pv");
		const retry = stepEvExecution(first.session, {
			nowMs: NOW + EV_FEEDBACK_TIMEOUT_MS,
			desiredMode: "pv",
			actualMode: "off",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(retry.writeMode, "pv");
		assert.equal(retry.session.retryCount, 1);
		assert.ok(retry.session.retryCount <= EV_MAX_RETRIES);
	});

	it("T10: no feedback → timeout / fail-safe", () => {
		let cur = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "now",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		for (let i = 0; i <= EV_MAX_RETRIES; i++) {
			cur = stepEvExecution(cur.session, {
				nowMs: NOW + EV_FEEDBACK_TIMEOUT_MS * (i + 1),
				desiredMode: "now",
				actualMode: "pv",
				writeAllowed: true,
				blockReason: "",
				failsafeReason: "",
				authorityIsEms: true,
			});
		}
		assert.equal(cur.session.phase, "failsafe");
		assert.equal(cur.session.failsafeReason, "feedback_timeout");
		assert.equal(cur.writeMode, null);
	});

	it("T11: EVCC source stale/offline → no write", () => {
		assert.equal(isEvccModeFeedbackStale({ tsMs: NOW - 11 * 60_000, nowMs: NOW }), true);
		const stale = evaluateEvccSourceFreshness({
			connectionValue: true,
			connectionKnown: true,
			heartbeatTsMs: NOW - 11 * 60_000,
			heartbeatConfigured: true,
			nowMs: NOW,
		});
		assert.equal(stale.fresh, false);
		assert.equal(stale.reason, "evcc_source_stale");
		const g = greenGates({ sourceStale: true });
		assert.equal(g.writeAllowed, false);
		assert.equal(g.failsafeReason, "evcc_source_stale");
		const offline = greenGates({ sourceOffline: true });
		assert.equal(offline.writeAllowed, false);
		assert.equal(offline.failsafeReason, "evcc_source_offline");
	});

	it("T12: missing button contract → no write", () => {
		const g = greenGates({ buttonsReady: false, resolvedVariant: "buttons" });
		assert.equal(g.writeAllowed, false);
		assert.equal(g.failsafeReason, "button_contract_unavailable");
	});

	it("T13: already confirmed desired mode → no redundant write", () => {
		const r = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "pv",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(r.writeMode, null);
		assert.equal(r.session.lastResult, "already_confirmed");
	});

	it("T14: pending PV, desired switches to NOW → old command is not retried", () => {
		const sent = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "pv",
			actualMode: "off",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(sent.session.pendingMode, "pv");
		const switched = stepEvExecution(sent.session, {
			nowMs: NOW + 5_000,
			desiredMode: "now",
			actualMode: "off",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(switched.writeMode, "now");
		assert.equal(switched.session.pendingMode, "now");
		assert.notEqual(switched.session.lastResult, "retry");
	});

	it("T15: pending EMS command, external becomes active → abort", () => {
		const sent = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "now",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		const aborted = stepEvExecution(sent.session, {
			nowMs: NOW + 5_000,
			desiredMode: "now",
			actualMode: "pv",
			writeAllowed: false,
			blockReason: "external_authority",
			failsafeReason: "",
			authorityIsEms: false,
		});
		assert.equal(aborted.writeMode, null);
		assert.equal(aborted.session.pendingMode, null);
		assert.equal(aborted.session.lastResult, "blocked");
	});

	it("T16: governance flips to dryrun during pending → no further writes", () => {
		const sent = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "now",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		const dry = stepEvExecution(sent.session, {
			nowMs: NOW + EV_FEEDBACK_TIMEOUT_MS,
			desiredMode: "now",
			actualMode: "pv",
			writeAllowed: false,
			blockReason: "global_dryrun",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(dry.writeMode, null);
		assert.equal(dry.session.pendingMode, null);
	});

	it("T17: addon live disabled during pending → no further writes", () => {
		const sent = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "pv",
			actualMode: "off",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		const off = stepEvExecution(sent.session, {
			nowMs: NOW + EV_FEEDBACK_TIMEOUT_MS,
			desiredMode: "pv",
			actualMode: "off",
			writeAllowed: false,
			blockReason: "addon_dryrun",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(off.writeMode, null);
	});

	it("T18: unknown/inconsistent authority → fail-safe / no write", () => {
		const auth = stabilizeExecutionAuthority({
			raw: "unknown",
			externalExpected: true,
			prevAuthority: "none",
			lastExternalHoldAtMs: null,
			lastInactiveSinceMs: null,
			nowMs: NOW,
		});
		assert.equal(auth.authority, "none");
		assert.equal(auth.failsafeReason, "authority_unknown");
		const g = greenGates({ authority: "none", authorityFailsafeReason: "authority_unknown" });
		assert.equal(g.writeAllowed, false);
		assert.equal(g.failsafeReason, "authority_unknown");
	});

	it("T19: legacy pvControl is not used as a modern button write", async () => {
		assert.equal(isAllowedEvccButtonWriteTarget(`${LP}.control.pvControl`, "pv"), false);
		const pvControlCfg = {
			...BUTTON_CFG,
			wb_evcc_mode_control: "pv_control",
			wb_evcc_control_pv_control_target: `${LP}.control.pvControl`,
		};
		const writes: string[] = [];
		const r = await executeEvccButtonWrite(
			{
				async getForeignStateAsync() {
					return { val: 1 } as ioBroker.State;
				},
				async setForeignStateAsync(id) {
					writes.push(id);
				},
			},
			{ contract: resolveEvccModeControlContract(pvControlCfg), mode: "pv", writeAllowed: true },
		);
		assert.equal(r.written, false);
		assert.ok(r.reason === "feature_gate" || r.reason === "legacy_variant_blocked");
		assert.equal(writes.length, 0);
	});

	it("T20: EV execution adds no direct go-e / Ford / Tibber / Sonnen writes", () => {
		const writeSrc = readFileSync(join(SRC, "ev_foundation", "execution", "write.ts"), "utf8");
		const tickSrc = readFileSync(join(SRC, "ev_foundation", "execution", "tick.ts"), "utf8");
		for (const src of [writeSrc, tickSrc]) {
			assert.equal(/setForeignStateAsync\(\s*["'`]go-e\./.test(src), false);
			assert.equal(/setForeignStateAsync\(\s*["'`]ford/.test(src), false);
			assert.equal(/writeForeignIfChanged\([\s\S]*["'`]sonnen\./.test(src), false);
			assert.equal(/writeForeignIfChanged\([\s\S]*["'`]tibber\./i.test(src), false);
		}
		assert.equal(isAllowedEvccButtonWriteTarget("go-e.0.allow_charging", "now"), false);
		assert.equal(isAllowedEvccButtonWriteTarget("sonnen.0.control.batteryMode", "now"), false);
		assert.equal(isAllowedEvccButtonWriteTarget("tibber.0.charge", "now"), false);
		assert.equal(isAllowedEvccButtonWriteTarget("fordpass.0.startCharge", "now"), false);
		assert.equal(EV_EXECUTION_PHASE5_ENABLED, false);
	});

	it("desired mode is a mechanical Unified translation", () => {
		assert.equal(
			projectDesiredEvccMode({
				intentAction: "hold",
				energySource: "grid",
				chargingAllowed: false,
				allocatedPowerW: 0,
			}).desired,
			"off",
		);
		assert.equal(
			projectDesiredEvccMode({
				intentAction: "charge",
				energySource: "pv_surplus",
				chargingAllowed: true,
				allocatedPowerW: 4000,
			}).desired,
			"pv",
		);
		assert.equal(
			projectDesiredEvccMode({
				intentAction: "charge",
				energySource: "mixed",
				chargingAllowed: true,
				allocatedPowerW: 3000,
			}).desired,
			"min",
		);
	});

	it("explain matches the Phase 5A contract", () => {
		assert.equal(
			formatEvExecutionExplain({
				desired: "now",
				actual: "pv",
				authority: "external",
				phase: "idle",
				blockReason: "external_authority",
				failsafeReason: "",
				writeAllowed: false,
			}),
			"desired=now, authority=external, write_blocked=external_authority",
		);
		assert.equal(
			formatEvExecutionExplain({
				desired: "pv",
				actual: "pv",
				authority: "ems",
				phase: "idle",
				blockReason: "global_dryrun",
				failsafeReason: "",
				writeAllowed: false,
			}),
			"desired=pv, authority=ems, write_blocked=global_dryrun",
		);
		assert.equal(
			formatEvExecutionExplain({
				desired: "now",
				actual: "pv",
				authority: "ems",
				phase: "awaiting_feedback",
				blockReason: "",
				failsafeReason: "",
				writeAllowed: true,
			}),
			"desired=now, authority=ems, awaiting_feedback",
		);
		assert.equal(
			formatEvExecutionExplain({
				desired: "now",
				actual: "now",
				authority: "ems",
				phase: "confirmed",
				blockReason: "",
				failsafeReason: "",
				writeAllowed: true,
			}),
			"desired=now, actual=now, confirmed",
		);
		assert.equal(
			formatEvExecutionExplain({
				desired: "pv",
				actual: null,
				authority: "ems",
				phase: "failsafe",
				blockReason: "evcc_source_stale",
				failsafeReason: "evcc_source_stale",
				writeAllowed: false,
			}),
			"desired=pv, write_blocked=evcc_source_stale",
		);
	});

	it("tick publishes diagnosis and never writes while the Phase 5A gate is closed", async () => {
		const { host, foreignWrites } = tickHost({ global: "live", addon: "live" });
		const snap = emptyEvccTelemetrySnapshot("2026-08-15T08:00:00.000Z");
		snap.loadpoint_mode = { value: "pv", status: "valid", raw: "pv" };
		const s = await tickEvExecution(host, {
			nowMs: NOW,
			snap,
			model: model(),
			planDecision: decision(),
			intent: intent(),
			faultActive: false,
			addonEnabled: true,
			governanceEnabled: true,
		});
		assert.equal(foreignWrites.length, 0);
		assert.equal(s.authority, "ems");
		assert.equal((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionEnabled))?.val, false);
		assert.equal((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionDesiredMode))?.val, "now");
		assert.ok(String((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionExplain))?.val).includes("desired=now"));
	});
});

describe("Phase 5B preflight: noop vs OFF and source freshness", () => {
	it("P1: hold with explicit 0 W stop → OFF", () => {
		const p = projectDesiredEvccMode({
			intentAction: "hold",
			energySource: "grid",
			chargingAllowed: false,
			allocatedPowerW: 0,
			dailyPlanStatus: "daily_plan_zero_allocation",
			useDailyPlan: true,
			planValid: true,
		});
		assert.equal(p.desired, "off");
		assert.equal(p.reason, "explicit_stop");
	});

	it("P2: hold with no consumer slot → No-Op", () => {
		const p = projectDesiredEvccMode({
			intentAction: "hold",
			energySource: "none",
			chargingAllowed: false,
			allocatedPowerW: null,
			dailyPlanStatus: "daily_plan_zero_allocation",
			useDailyPlan: true,
			planValid: true,
		});
		assert.equal(p.desired, "noop");
		assert.equal(p.reason, "no_planned_wallbox_action");
	});

	it("P3: none = no EMS action → No-Op / no write", () => {
		const p = projectDesiredEvccMode({
			intentAction: "none",
			energySource: "none",
			chargingAllowed: false,
			allocatedPowerW: null,
			decisionSource: "vehicle_disconnected",
		});
		assert.equal(p.desired, "noop");
		assert.equal(p.reason, "no_wallbox_action");
		const stepped = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "noop",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
			desiredReason: "no_wallbox_action",
		});
		assert.equal(stepped.writeMode, null);
		assert.equal(stepped.session.pendingMode, null);
		assert.equal(stepped.session.lastResult, "noop");
	});

	it("P4: no allocation → no automatic OFF", () => {
		const p = projectDesiredEvccMode({
			intentAction: "hold",
			energySource: "none",
			chargingAllowed: false,
			allocatedPowerW: null,
		});
		assert.notEqual(p.desired, "off");
		assert.equal(p.desired, "noop");
	});

	it("P5: explicit charge-stop (charge denied / 0 W) → OFF", () => {
		const p = projectDesiredEvccMode({
			intentAction: "charge",
			energySource: "grid",
			chargingAllowed: false,
			allocatedPowerW: 0,
		});
		assert.equal(p.desired, "off");
		assert.equal(p.reason, "explicit_stop");
	});

	it("P6: No-Op creates no pending", () => {
		const stepped = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "noop",
			actualMode: "now",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
			desiredReason: "no_planned_wallbox_action",
		});
		assert.equal(stepped.session.pendingMode, null);
		assert.equal(stepped.session.pendingSinceMs, null);
		assert.equal(stepped.session.phase, "idle");
	});

	it("P7: No-Op creates no retry", () => {
		const sent = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "pv",
			actualMode: "off",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(sent.session.pendingMode, "pv");
		const noop = stepEvExecution(sent.session, {
			nowMs: NOW + EV_FEEDBACK_TIMEOUT_MS,
			desiredMode: "noop",
			actualMode: "off",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
			desiredReason: "no_wallbox_action",
		});
		assert.equal(noop.writeMode, null);
		assert.equal(noop.session.pendingMode, null);
		assert.notEqual(noop.session.lastResult, "retry");
		assert.equal(noop.session.retryCount, 0);
	});

	it("P8: No-Op is not fail-safe", () => {
		const stepped = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "noop",
			actualMode: null,
			writeAllowed: false,
			blockReason: "evcc_source_stale",
			failsafeReason: "evcc_source_stale",
			authorityIsEms: true,
			desiredReason: "no_wallbox_action",
		});
		assert.equal(stepped.session.phase, "idle");
		assert.equal(stepped.session.failsafeReason, "");
		assert.equal(stepped.session.lastResult, "noop");
		const g = greenGates({ desiredMode: "noop", sourceStale: true, actualMissing: true });
		assert.equal(g.failsafeReason, "");
		assert.equal(g.writeAllowed, false);
		assert.equal(
			formatEvExecutionExplain({
				desired: "noop",
				actual: "pv",
				authority: "ems",
				phase: "idle",
				blockReason: "",
				failsafeReason: "",
				writeAllowed: false,
				desiredReason: "no_planned_wallbox_action",
			}),
			"desired=noop, reason=no_planned_wallbox_action",
		);
	});

	it("P9: status.mode=off, ts older than 10 min, EVCC source fresh → valid", () => {
		const source = evaluateEvccSourceFreshness({
			connectionValue: true,
			connectionKnown: true,
			heartbeatTsMs: NOW - 30_000,
			heartbeatConfigured: true,
			nowMs: NOW,
		});
		assert.equal(source.fresh, true);
		const g = greenGates({
			desiredMode: "off",
			sourceStale: !source.fresh,
			sourceOffline: false,
			actualMissing: false,
			actualInvalid: false,
		});
		assert.equal(g.failsafeReason, "");
		assert.equal(
			formatEvExecutionExplain({
				desired: "off",
				actual: "off",
				authority: "ems",
				phase: "confirmed",
				blockReason: "",
				failsafeReason: "",
				writeAllowed: true,
				sourceFresh: true,
			}),
			"desired=off, actual=off, source_fresh=true",
		);
	});

	it("P10: status.mode=pv, ts older than 10 min, EVCC source fresh → valid", () => {
		const source = evaluateEvccSourceFreshness({
			connectionValue: true,
			connectionKnown: true,
			heartbeatTsMs: NOW,
			heartbeatConfigured: true,
			nowMs: NOW,
		});
		assert.equal(source.fresh, true);
		assert.equal(
			evaluateEvccSourceFreshness({
				connectionValue: null,
				connectionKnown: false,
				heartbeatTsMs: null,
				heartbeatConfigured: false,
				nowMs: NOW,
			}).fresh,
			true,
			"missing heartbeat must not invent stale from status.mode.ts",
		);
		const g = greenGates({ desiredMode: "pv", sourceStale: false });
		assert.equal(g.failsafeReason, "");
	});

	it("P11: EVCC source stale/offline blocks execution", () => {
		assert.equal(
			evaluateEvccSourceFreshness({
				connectionValue: false,
				connectionKnown: true,
				heartbeatTsMs: NOW,
				heartbeatConfigured: true,
				nowMs: NOW,
			}).reason,
			"evcc_source_offline",
		);
		const g = greenGates({ sourceOffline: true, desiredMode: "now" });
		assert.equal(g.writeAllowed, false);
		assert.equal(g.failsafeReason, "evcc_source_offline");
	});

	it("P12: new command, fresh feedback confirms success", () => {
		const sent = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "now",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
			modeTsMs: NOW - 30 * 60_000,
		});
		assert.equal(sent.writeMode, "now");
		const confirmed = stepEvExecution(sent.session, {
			nowMs: NOW + 20_000,
			desiredMode: "now",
			actualMode: "now",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
			modeTsMs: NOW + 18_000,
		});
		assert.equal(confirmed.session.phase, "confirmed");
		assert.equal(confirmed.writeMode, null);
		assert.equal(confirmed.session.lastResult, "confirmed");
	});

	it("P13: new command, old identical state without new ts → no fake success", () => {
		const sent = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "now",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(
			isCommandFeedbackConfirmed({
				actualMode: "now",
				pendingMode: "now",
				lastCommandAtMs: sent.session.lastCommandAtMs,
				modeTsMs: NOW - 30 * 60_000,
			}),
			false,
		);
		const fake = stepEvExecution(sent.session, {
			nowMs: NOW + 20_000,
			desiredMode: "now",
			actualMode: "now",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
			modeTsMs: NOW - 30 * 60_000,
		});
		assert.notEqual(fake.session.phase, "confirmed");
		assert.equal(fake.session.lastResult, "awaiting_feedback");
		assert.equal(fake.writeMode, null);
	});

	it("P14: already matching desired before command → no redundant write", () => {
		const r = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "pv",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
			modeTsMs: NOW - 40 * 60_000,
		});
		assert.equal(r.writeMode, null);
		assert.equal(r.session.lastResult, "already_confirmed");
	});

	it("P15: hold below min power is an explicit stop, power_limits_unknown is No-Op", () => {
		assert.equal(
			projectDesiredEvccMode({
				intentAction: "hold",
				energySource: "grid",
				chargingAllowed: false,
				allocatedPowerW: 800,
				dailyPlanStatus: "allocation_below_min_power",
			}).desired,
			"off",
		);
		assert.equal(
			projectDesiredEvccMode({
				intentAction: "hold",
				energySource: "grid",
				chargingAllowed: false,
				allocatedPowerW: 4000,
				dailyPlanStatus: "power_limits_unknown",
			}).desired,
			"noop",
		);
	});

	it("tick: none intent publishes noop diagnosis and never writes", async () => {
		const { host, foreignWrites } = tickHost({ global: "live", addon: "live" });
		const snap = emptyEvccTelemetrySnapshot("2026-08-15T08:00:00.000Z");
		snap.loadpoint_mode = { value: "pv", status: "valid", raw: "pv" };
		snap.connection = { value: true, status: "valid", raw: true };
		const s = await tickEvExecution(host, {
			nowMs: NOW,
			snap,
			model: model(),
			planDecision: decision({
				chargingAllowedByPlan: false,
				allocatedPowerW: null,
				planValid: false,
				useDailyPlan: false,
				decisionSource: "no_plan",
			}),
			intent: intent({ action: "none", enabled: false, targetPowerW: 0, source: "none" }),
			faultActive: false,
			addonEnabled: true,
			governanceEnabled: true,
		});
		assert.equal(foreignWrites.length, 0);
		assert.equal(s.lastResult, "noop");
		assert.equal(s.failsafeReason, "");
		assert.equal(s.pendingMode, null);
		assert.equal((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionDesiredMode))?.val, "noop");
		assert.equal(
			(await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionDesiredReason))?.val,
			"no_wallbox_action",
		);
		assert.match(String((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionExplain))?.val), /desired=noop/);
	});

	it("tick: old status.mode ts stays valid when connection is up", async () => {
		const { host, foreignWrites } = tickHost({
			global: "live",
			addon: "live",
			foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW - 40 * 60_000 } },
		});
		const snap = emptyEvccTelemetrySnapshot("2026-08-15T08:00:00.000Z");
		snap.loadpoint_mode = { value: "off", status: "valid", raw: "off" };
		snap.connection = { value: true, status: "valid", raw: true };
		const s = await tickEvExecution(host, {
			nowMs: NOW,
			snap,
			model: model(),
			planDecision: decision({
				chargingAllowedByPlan: false,
				allocatedPowerW: 0,
				dailyPlanStatus: "daily_plan_zero_allocation",
				decisionSource: "daily_plan_zero",
			}),
			intent: intent({ action: "hold", enabled: false, targetPowerW: 0, source: "none" }),
			faultActive: false,
			addonEnabled: true,
			governanceEnabled: true,
		});
		assert.equal(foreignWrites.length, 0);
		assert.equal(s.sourceFresh, true);
		assert.notEqual(s.failsafeReason, "status_mode_stale");
		assert.notEqual(s.failsafeReason, "evcc_source_stale");
		assert.equal((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionDesiredMode))?.val, "off");
		assert.equal((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionSourceFresh))?.val, true);
	});
});

function owningSession(mode: "pv" | "min" | "now"): EvExecutionSession {
	return {
		...emptyEvExecutionSession(),
		phase: "confirmed",
		authority: "ems",
		ownership: "ems",
		ownedMode: mode,
		ownedSinceMs: NOW,
		lastConfirmedMode: mode,
		lastResult: "confirmed",
	};
}

function noSlotProjection() {
	return projectDesiredEvccMode({
		intentAction: "hold",
		energySource: "none",
		chargingAllowed: false,
		allocatedPowerW: null,
		dailyPlanStatus: "daily_plan_zero_allocation",
		useDailyPlan: true,
		planValid: true,
	});
}

describe("Phase 5B ownership & release", () => {
	it("O1: pre-existing PV not owned by EMS → noop does not write OFF", () => {
		const projection = noSlotProjection();
		assert.equal(projection.desired, "noop");
		const resolved = resolveDesiredWithOwnership({
			projection,
			ownership: "unknown",
			ownedMode: null,
			planValid: true,
			useDailyPlan: true,
			authority: "ems",
		});
		assert.equal(resolved.desired, "noop");
		assert.equal(resolved.action, "noop");
		const stepped = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: resolved.desired,
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
			desiredReason: resolved.reason,
		});
		assert.equal(stepped.writeMode, null);
		assert.equal(stepped.session.ownership, "unknown");
	});

	it("O2: EMS write PV + confirmed feedback → ownership granted", () => {
		const sent = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "pv",
			actualMode: "off",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(sent.writeMode, "pv");
		assert.notEqual(sent.session.ownership, "ems");
		const confirmed = stepEvExecution(sent.session, {
			nowMs: NOW + 20_000,
			desiredMode: "pv",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
			modeTsMs: NOW + 18_000,
		});
		assert.equal(confirmed.session.ownership, "ems");
		assert.equal(confirmed.session.ownedMode, "pv");
		assert.ok(confirmed.session.ownedSinceMs);
	});

	it("O3: EMS owns PV + valid plan ends wallbox slot → release OFF", () => {
		const resolved = resolveDesiredWithOwnership({
			projection: noSlotProjection(),
			ownership: "ems",
			ownedMode: "pv",
			planValid: true,
			useDailyPlan: true,
			authority: "ems",
		});
		assert.equal(resolved.desired, "off");
		assert.equal(resolved.action, "release_off");
		assert.equal(shouldReleaseOwnedCharge({
			projectedDesired: "noop",
			projectedReason: "no_planned_wallbox_action",
			ownership: "ems",
			ownedMode: "pv",
			planValid: true,
			useDailyPlan: true,
			authority: "ems",
		}), true);
		const stepped = stepEvExecution(owningSession("pv"), {
			nowMs: NOW,
			desiredMode: "off",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
			desiredReason: "release_off",
		});
		assert.equal(stepped.writeMode, "off");
	});

	it("O4: release OFF confirmed → ownership ended", () => {
		const sent = stepEvExecution(owningSession("pv"), {
			nowMs: NOW,
			desiredMode: "off",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
			desiredReason: "release_off",
		});
		const confirmed = stepEvExecution(
			{ ...sent.session, releaseReason: "release_off" },
			{
				nowMs: NOW + 20_000,
				desiredMode: "off",
				actualMode: "off",
				writeAllowed: true,
				blockReason: "",
				failsafeReason: "",
				authorityIsEms: true,
				modeTsMs: NOW + 18_000,
			},
		);
		assert.equal(confirmed.session.phase, "confirmed");
		assert.equal(confirmed.session.ownership, "none");
		assert.equal(confirmed.session.ownedMode, null);
	});

	it("O5: EMS owns NOW + valid plan end → release OFF", () => {
		const resolved = resolveDesiredWithOwnership({
			projection: noSlotProjection(),
			ownership: "ems",
			ownedMode: "now",
			planValid: true,
			useDailyPlan: true,
			authority: "ems",
		});
		assert.equal(resolved.action, "release_off");
		assert.equal(resolved.desired, "off");
	});

	it("O6: EMS owns PV + planner uncertain → no release OFF", () => {
		const projection = projectDesiredEvccMode({
			intentAction: "hold",
			energySource: "grid",
			chargingAllowed: false,
			allocatedPowerW: 4000,
			dailyPlanStatus: "power_limits_unknown",
			planValid: true,
			useDailyPlan: true,
		});
		const resolved = resolveDesiredWithOwnership({
			projection,
			ownership: "ems",
			ownedMode: "pv",
			planValid: true,
			useDailyPlan: true,
			authority: "ems",
		});
		assert.equal(resolved.desired, "noop");
		assert.equal(resolved.action, "noop");
	});

	it("O7: EMS owns PV + plan missing/invalid → no release OFF", () => {
		const projection = projectDesiredEvccMode({
			intentAction: "none",
			energySource: "none",
			chargingAllowed: false,
			allocatedPowerW: null,
			decisionSource: "invalid_plan",
			planValid: false,
			useDailyPlan: false,
		});
		const resolved = resolveDesiredWithOwnership({
			projection,
			ownership: "ems",
			ownedMode: "pv",
			planValid: false,
			useDailyPlan: false,
			authority: "ems",
		});
		assert.equal(resolved.desired, "noop");
		assert.equal(resolved.action, "noop");
	});

	it("O8: EMS owns PV + external becomes active → no OFF, ownership released", () => {
		const dropped = dropExecutionOwnership(owningSession("pv"), {
			authority: "external",
			actualMode: "pv",
		});
		assert.equal(dropped.ownership, "none");
		assert.equal(dropped.releaseReason, "external_authority");
		const resolved = resolveDesiredWithOwnership({
			projection: noSlotProjection(),
			ownership: dropped.ownership,
			ownedMode: dropped.ownedMode,
			planValid: true,
			useDailyPlan: true,
			authority: "external",
		});
		assert.equal(resolved.action, "noop");
		const stepped = stepEvExecution(dropped, {
			nowMs: NOW,
			desiredMode: "noop",
			actualMode: "pv",
			writeAllowed: false,
			blockReason: "external_authority",
			failsafeReason: "",
			authorityIsEms: false,
		});
		assert.equal(stepped.writeMode, null);
	});

	it("O9: EMS owns PV + authority unknown → no OFF", () => {
		const dropped = dropExecutionOwnership(owningSession("pv"), {
			authority: "none",
			actualMode: "pv",
		});
		assert.equal(dropped.ownership, "none");
		assert.equal(dropped.releaseReason, "authority_unknown");
		assert.equal(
			resolveDesiredWithOwnership({
				projection: noSlotProjection(),
				ownership: dropped.ownership,
				ownedMode: null,
				planValid: true,
				useDailyPlan: true,
				authority: "none",
			}).action,
			"noop",
		);
	});

	it("O10: EMS owns PV + global dryrun → no release write", () => {
		const resolved = resolveDesiredWithOwnership({
			projection: noSlotProjection(),
			ownership: "ems",
			ownedMode: "pv",
			planValid: true,
			useDailyPlan: true,
			authority: "ems",
		});
		assert.equal(resolved.desired, "off");
		const g = greenGates({ desiredMode: "off", globalLive: false });
		assert.equal(g.writeAllowed, false);
		assert.equal(g.blockReason, "global_dryrun");
		const stepped = stepEvExecution(owningSession("pv"), {
			nowMs: NOW,
			desiredMode: "off",
			actualMode: "pv",
			writeAllowed: false,
			blockReason: "global_dryrun",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(stepped.writeMode, null);
		assert.equal(stepped.session.ownership, "ems");
	});

	it("O11: EMS owns PV + addon live off → no release write", () => {
		const g = greenGates({ desiredMode: "off", addonLive: false });
		assert.equal(g.writeAllowed, false);
		assert.equal(g.blockReason, "addon_dryrun");
		const stepped = stepEvExecution(owningSession("pv"), {
			nowMs: NOW,
			desiredMode: "off",
			actualMode: "pv",
			writeAllowed: false,
			blockReason: "addon_dryrun",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(stepped.writeMode, null);
		assert.equal(stepped.session.ownership, "ems");
	});

	it("O12: EMS owns PV + EVCC source stale → no release write", () => {
		const g = greenGates({ desiredMode: "off", sourceStale: true });
		assert.equal(g.writeAllowed, false);
		assert.equal(g.failsafeReason, "evcc_source_stale");
		const stepped = stepEvExecution(owningSession("pv"), {
			nowMs: NOW,
			desiredMode: "off",
			actualMode: "pv",
			writeAllowed: false,
			blockReason: "evcc_source_stale",
			failsafeReason: "evcc_source_stale",
			authorityIsEms: true,
		});
		assert.equal(stepped.writeMode, null);
	});

	it("O13: EMS owns PV + Unified switches to NOW → normal mode change, not release", () => {
		const projection = projectDesiredEvccMode({
			intentAction: "charge",
			energySource: "grid",
			chargingAllowed: true,
			allocatedPowerW: 11000,
		});
		const resolved = resolveDesiredWithOwnership({
			projection,
			ownership: "ems",
			ownedMode: "pv",
			planValid: true,
			useDailyPlan: true,
			authority: "ems",
		});
		assert.equal(resolved.desired, "now");
		assert.equal(resolved.action, "execute");
		const stepped = stepEvExecution(owningSession("pv"), {
			nowMs: NOW,
			desiredMode: "now",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(stepped.writeMode, "now");
		assert.notEqual(stepped.session.lastResult, "noop");
	});

	it("O14: EMS owns NOW + Unified switches to PV → normal mode change", () => {
		const projection = projectDesiredEvccMode({
			intentAction: "charge",
			energySource: "pv_surplus",
			chargingAllowed: true,
			allocatedPowerW: 4000,
		});
		const resolved = resolveDesiredWithOwnership({
			projection,
			ownership: "ems",
			ownedMode: "now",
			planValid: true,
			useDailyPlan: true,
			authority: "ems",
		});
		assert.equal(resolved.desired, "pv");
		assert.equal(resolved.action, "execute");
	});

	it("O15: explicit planner OFF works without ownership", () => {
		const projection = projectDesiredEvccMode({
			intentAction: "hold",
			energySource: "grid",
			chargingAllowed: false,
			allocatedPowerW: 0,
			dailyPlanStatus: "daily_plan_zero_allocation",
			planValid: true,
			useDailyPlan: true,
		});
		const resolved = resolveDesiredWithOwnership({
			projection,
			ownership: "unknown",
			ownedMode: null,
			planValid: true,
			useDailyPlan: true,
			authority: "ems",
		});
		assert.equal(resolved.desired, "off");
		assert.equal(resolved.action, "explicit_stop");
		const stepped = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "off",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
			desiredReason: "explicit_stop",
		});
		assert.equal(stepped.writeMode, "off");
	});

	it("O16: manual/external mode change after EMS PV → ownership invalidated", () => {
		const dropped = dropExecutionOwnership(owningSession("pv"), {
			authority: "ems",
			actualMode: "now",
		});
		assert.equal(dropped.ownership, "none");
		assert.equal(dropped.releaseReason, "actual_mode_changed_externally");
		assert.equal(
			formatEvExecutionExplain({
				desired: "noop",
				actual: "now",
				authority: "ems",
				phase: "idle",
				blockReason: "",
				failsafeReason: "",
				writeAllowed: false,
				ownership: "none",
				releaseReason: "actual_mode_changed_externally",
				action: "noop",
			}),
			"actual_mode_changed_externally, ownership_lost=true",
		);
	});

	it("O17: restart with EVCC already on PV → no ownership assumption and no blind OFF", async () => {
		resetEvExecutionSession();
		const { host, foreignWrites } = tickHost({ global: "live", addon: "live" });
		const snap = emptyEvccTelemetrySnapshot("2026-08-15T08:00:00.000Z");
		snap.loadpoint_mode = { value: "pv", status: "valid", raw: "pv" };
		snap.connection = { value: true, status: "valid", raw: true };
		const s = await tickEvExecution(host, {
			nowMs: NOW,
			snap,
			model: model(),
			planDecision: decision({
				chargingAllowedByPlan: false,
				allocatedPowerW: null,
				dailyPlanStatus: "daily_plan_zero_allocation",
				decisionSource: "daily_plan_zero",
				planValid: true,
				useDailyPlan: true,
			}),
			intent: intent({ action: "hold", enabled: false, targetPowerW: 0, source: "none" }),
			faultActive: false,
			addonEnabled: true,
			governanceEnabled: true,
		});
		assert.equal(s.ownership, "unknown");
		assert.equal(s.ownedMode, null);
		assert.equal((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionDesiredMode))?.val, "noop");
		assert.equal(foreignWrites.length, 0);
		assert.notEqual(s.releaseReason, "release_off");
	});

	it("O18: No-Op without ownership creates neither pending nor retry", () => {
		const stepped = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "noop",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
			desiredReason: "no_planned_wallbox_action",
		});
		assert.equal(stepped.session.pendingMode, null);
		assert.equal(stepped.session.retryCount, 0);
		assert.equal(stepped.session.phase, "idle");
		assert.equal(stepped.session.lastResult, "noop");
		assert.equal(stepped.session.failsafeReason, "");
	});

	it("O19: release OFF uses only the EVCC button contract", () => {
		const contract = resolveEvccModeControlContract(BUTTON_CFG);
		assert.equal(buttonStateId(contract, "off"), `${LP}.control.off`);
		assert.equal(isAllowedEvccButtonWriteTarget(`${LP}.control.off`, "off"), true);
		const writeSrc = readFileSync(join(SRC, "ev_foundation", "execution", "write.ts"), "utf8");
		const ownSrc = readFileSync(join(SRC, "ev_foundation", "execution", "ownership.ts"), "utf8");
		assert.equal(/setForeignStateAsync/.test(ownSrc), false);
		assert.equal(/go-e\.|fordpass\.|tibber\.|sonnen\./.test(ownSrc), false);
		assert.match(writeSrc, /Only EVCC button pulses/);
	});

	it("O20: no new go-e / Ford / Tibber / Sonnen write path", () => {
		const ownSrc = readFileSync(join(SRC, "ev_foundation", "execution", "ownership.ts"), "utf8");
		const tickSrc = readFileSync(join(SRC, "ev_foundation", "execution", "tick.ts"), "utf8");
		for (const src of [ownSrc, tickSrc]) {
			assert.equal(/setForeignStateAsync\(\s*["'`]go-e\./.test(src), false);
			assert.equal(/setForeignStateAsync\(\s*["'`]ford/.test(src), false);
			assert.equal(/writeForeignIfChanged\([\s\S]*["'`]sonnen\./.test(src), false);
			assert.equal(/writeForeignIfChanged\([\s\S]*["'`]tibber\./i.test(src), false);
		}
		assert.equal(EV_EXECUTION_PHASE5_ENABLED, false);
	});

	it("tick: owned PV + valid no-slot plan publishes release diagnosis without writing", async () => {
		replaceEvExecutionSession(owningSession("pv"));
		const { host, foreignWrites } = tickHost({ global: "live", addon: "live" });
		const snap = emptyEvccTelemetrySnapshot("2026-08-15T08:00:00.000Z");
		snap.loadpoint_mode = { value: "pv", status: "valid", raw: "pv" };
		snap.connection = { value: true, status: "valid", raw: true };
		const s = await tickEvExecution(host, {
			nowMs: NOW,
			snap,
			model: model(),
			planDecision: decision({
				chargingAllowedByPlan: false,
				allocatedPowerW: null,
				dailyPlanStatus: "daily_plan_zero_allocation",
				decisionSource: "daily_plan_zero",
				planValid: true,
				useDailyPlan: true,
			}),
			intent: intent({ action: "hold", enabled: false, targetPowerW: 0, source: "none" }),
			faultActive: false,
			addonEnabled: true,
			governanceEnabled: true,
		});
		assert.equal(foreignWrites.length, 0);
		assert.equal(s.releaseReason, "release_off");
		assert.equal((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionOwnership))?.val, "ems");
		assert.equal((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionOwnedMode))?.val, "pv");
		assert.match(
			String((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionExplain))?.val),
			/action=release_off/,
		);
	});

	it("already_confirmed matching mode does not invent ownership", () => {
		const r = stepEvExecution(emptyEvExecutionSession(), {
			nowMs: NOW,
			desiredMode: "pv",
			actualMode: "pv",
			writeAllowed: true,
			blockReason: "",
			failsafeReason: "",
			authorityIsEms: true,
		});
		assert.equal(r.session.lastResult, "already_confirmed");
		assert.equal(r.session.ownership, "unknown");
		assert.equal(r.writeMode, null);
	});
});

function liveSnap(mode: string) {
	const snap = emptyEvccTelemetrySnapshot("2026-08-15T08:00:00.000Z");
	snap.loadpoint_mode = { value: mode, status: "valid", raw: mode };
	snap.connection = { value: true, status: "valid", raw: true };
	return snap;
}

function pvChargeInput(nowMs = NOW, actual = "off") {
	return {
		nowMs,
		snap: liveSnap(actual),
		model: model(),
		planDecision: decision({
			energySource: "pv_surplus" as const,
			allocatedPowerW: 4000,
			gridPowerW: 0,
			pvPowerW: 4000,
		}),
		intent: intent({ source: "pv_surplus" as const, targetPowerW: 4000 }),
		faultActive: false,
		addonEnabled: true,
		governanceEnabled: true,
	};
}

function nowChargeInput(nowMs = NOW, actual = "off") {
	return {
		nowMs,
		snap: liveSnap(actual),
		model: model(),
		planDecision: decision(),
		intent: intent(),
		faultActive: false,
		addonEnabled: true,
		governanceEnabled: true,
	};
}

function noopInput(nowMs = NOW, actual = "pv") {
	return {
		nowMs,
		snap: liveSnap(actual),
		model: model(),
		planDecision: decision({
			chargingAllowedByPlan: false,
			allocatedPowerW: null,
			planValid: false,
			useDailyPlan: false,
			decisionSource: "no_plan" as const,
		}),
		intent: intent({ action: "none" as const, enabled: false, targetPowerW: 0, source: "none" as const }),
		faultActive: false,
		addonEnabled: true,
		governanceEnabled: true,
	};
}

function noSlotOwnedInput(nowMs = NOW, actual = "pv") {
	return {
		nowMs,
		snap: liveSnap(actual),
		model: model(),
		planDecision: decision({
			chargingAllowedByPlan: false,
			allocatedPowerW: null,
			dailyPlanStatus: "daily_plan_zero_allocation" as const,
			decisionSource: "daily_plan_zero" as const,
			planValid: true,
			useDailyPlan: true,
		}),
		intent: intent({ action: "hold" as const, enabled: false, targetPowerW: 0, source: "none" as const }),
		faultActive: false,
		addonEnabled: true,
		governanceEnabled: true,
	};
}

async function bootThenArm(
	host: EvExecutionTickHost,
	setLocal: (id: string, val: unknown, ack?: boolean) => void,
	input: Parameters<typeof tickEvExecution>[1],
): Promise<void> {
	await tickEvExecution(host, input);
	setLocal(WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestArmed, true, false);
}

describe("Phase 5B controlled live test", () => {
	it("L0: Dauerbetrieb gate stays false; one-shot permit is extra", () => {
		assert.equal(EV_EXECUTION_PHASE5_ENABLED, false);
		const closed = greenGates({ featureEnabled: true });
		assert.equal(closed.writeAllowed, false);
		assert.equal(closed.blockReason, "feature_gate");
		const permitted = greenGates({ featureEnabled: false, liveTestPermit: true });
		assert.equal(permitted.writeAllowed, true);
		assert.equal(permitted.blockReason, "");
	});

	it("L1: not armed → no productive Phase-5 write", async () => {
		const { host, foreignWrites } = tickHost({ global: "live", addon: "live" });
		await tickEvExecution(host, pvChargeInput());
		assert.equal(foreignWrites.length, 0);
		assert.equal(peekEvLiveTestState().consumed, false);
		assert.equal((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionEnabled))?.val, false);
	});

	it("L2: armed + global dryrun → no write, not consumed", async () => {
		const { host, foreignWrites, setLocal } = tickHost({ global: "dryrun", addon: "live" });
		await bootThenArm(host, setLocal, pvChargeInput());
		const s = await tickEvExecution(host, pvChargeInput());
		assert.equal(foreignWrites.length, 0);
		assert.equal(peekEvLiveTestState().consumed, false);
		assert.equal(peekEvLiveTestState().armed, true);
		assert.match(s.explain, /live_test=armed/);
		assert.match(s.explain, /write_blocked=global_dryrun/);
	});

	it("L3: armed + addon not live → no write, not consumed", async () => {
		const { host, foreignWrites, setLocal } = tickHost({ global: "live", addon: "dryrun" });
		await bootThenArm(host, setLocal, pvChargeInput());
		await tickEvExecution(host, pvChargeInput());
		assert.equal(foreignWrites.length, 0);
		assert.equal(peekEvLiveTestState().consumed, false);
	});

	it("L4: armed + external authority → no write, not consumed", async () => {
		const { host, foreignWrites, setLocal } = tickHost({ global: "live", addon: "live" });
		const input = {
			...pvChargeInput(),
			model: model({
				externalControlConfigured: true,
				externalControlType: "vehicle",
				externalControlActive: true,
				externalAuthorityState: "active",
			}),
		};
		await bootThenArm(host, setLocal, input);
		const s = await tickEvExecution(host, input);
		assert.equal(foreignWrites.length, 0);
		assert.equal(peekEvLiveTestState().consumed, false);
		assert.equal(s.explain, "live_test=armed, authority=external, blocked");
		assert.equal((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestBlockReason))?.val, "external_authority");
	});

	it("L5: armed + noop → no write, not consumed", async () => {
		const { host, foreignWrites, setLocal } = tickHost({ global: "live", addon: "live" });
		await bootThenArm(host, setLocal, noopInput());
		const s = await tickEvExecution(host, noopInput());
		assert.equal(foreignWrites.length, 0);
		assert.equal(peekEvLiveTestState().consumed, false);
		assert.equal(peekEvLiveTestState().armed, true);
		assert.equal(s.explain, "live_test=armed, desired=noop, no_command_sent");
	});

	it("L6: armed + already-confirmed → no write, not consumed, no ownership", async () => {
		const { host, foreignWrites, setLocal } = tickHost({
			global: "live",
			addon: "live",
			foreign: { [`${LP}.status.mode`]: { val: "pv", ts: NOW } },
		});
		await bootThenArm(host, setLocal, pvChargeInput(NOW, "pv"));
		const s = await tickEvExecution(host, pvChargeInput(NOW, "pv"));
		assert.equal(foreignWrites.length, 0);
		assert.equal(peekEvLiveTestState().consumed, false);
		assert.equal(s.lastResult, "already_confirmed");
		assert.equal(s.ownership, "unknown");
		assert.equal(s.explain, "live_test=armed, desired=pv, already_confirmed");
	});

	it("L7: armed + valid pv → exactly one first button pulse, consumed", async () => {
		const { host, foreignWrites, setLocal } = tickHost({
			global: "live",
			addon: "live",
			foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
		});
		await bootThenArm(host, setLocal, pvChargeInput());
		const s = await tickEvExecution(host, pvChargeInput());
		assert.deepEqual(foreignWrites, [{ id: `${LP}.control.pv`, val: true }]);
		assert.equal(peekEvLiveTestState().consumed, true);
		assert.equal(peekEvLiveTestState().armed, false);
		assert.equal(peekEvLiveTestState().command, "pv");
		assert.equal(s.ownership, "unknown");
		assert.equal(s.explain, "live_test=consumed, command=pv, awaiting_feedback");
		assert.equal((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestArmed))?.val, false);
		assert.equal((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestConsumed))?.val, true);
		assert.equal((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionLastCommand))?.val, "pv");
	});

	it("L8: armed + valid now → exactly one first button pulse, consumed", async () => {
		const { host, foreignWrites, setLocal } = tickHost({
			global: "live",
			addon: "live",
			foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
		});
		await bootThenArm(host, setLocal, nowChargeInput());
		const s = await tickEvExecution(host, nowChargeInput());
		assert.deepEqual(foreignWrites, [{ id: `${LP}.control.now`, val: true }]);
		assert.equal(peekEvLiveTestState().command, "now");
		assert.equal(s.explain, "live_test=consumed, command=now, awaiting_feedback");
	});

	it("L9: after consumed no second new desired command", async () => {
		const { host, foreignWrites, setLocal } = tickHost({
			global: "live",
			addon: "live",
			foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
		});
		await bootThenArm(host, setLocal, pvChargeInput());
		await tickEvExecution(host, pvChargeInput());
		assert.equal(foreignWrites.length, 1);
		const s = await tickEvExecution(host, nowChargeInput(NOW + 5_000));
		assert.equal(foreignWrites.length, 1);
		assert.equal(s.blockReason, "live_test_consumed");
		assert.equal(peekEvLiveTestState().command, "pv");
	});

	it("L10: retry of the same pending command stays allowed", async () => {
		const { host, foreignWrites, setLocal } = tickHost({
			global: "live",
			addon: "live",
			foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
		});
		await bootThenArm(host, setLocal, pvChargeInput());
		await tickEvExecution(host, pvChargeInput());
		assert.equal(foreignWrites.length, 1);
		const retry = await tickEvExecution(host, pvChargeInput(NOW + EV_FEEDBACK_TIMEOUT_MS, "off"));
		assert.equal(foreignWrites.length, 2);
		assert.equal(foreignWrites[1]?.id, `${LP}.control.pv`);
		assert.equal(retry.retryCount, 1);
		assert.ok(retry.retryCount <= EV_MAX_RETRIES);
		assert.equal(peekEvLiveTestState().consumed, true);
	});

	it("L11: external takeover during pending → no further retries", async () => {
		const { host, foreignWrites, setLocal } = tickHost({
			global: "live",
			addon: "live",
			foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
		});
		await bootThenArm(host, setLocal, pvChargeInput());
		await tickEvExecution(host, pvChargeInput());
		const external = {
			...pvChargeInput(NOW + EV_FEEDBACK_TIMEOUT_MS),
			model: model({
				externalControlConfigured: true,
				externalControlType: "vehicle",
				externalControlActive: true,
				externalAuthorityState: "active",
			}),
		};
		const s = await tickEvExecution(host, external);
		assert.equal(foreignWrites.length, 1);
		assert.equal(s.pendingMode, null);
		assert.equal(peekEvLiveTestState().consumed, true);
		assert.notEqual(s.lastResult, "retry");
	});

	it("L12: disarm before first write → no write", async () => {
		const { host, foreignWrites, setLocal } = tickHost({
			global: "live",
			addon: "live",
			foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
		});
		await bootThenArm(host, setLocal, pvChargeInput());
		setLocal(WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestArmed, false, false);
		await tickEvExecution(host, pvChargeInput());
		assert.equal(foreignWrites.length, 0);
		assert.equal(peekEvLiveTestState().armed, false);
		assert.equal(peekEvLiveTestState().consumed, false);
	});

	it("L13: disarm after first pulse → no new retries", async () => {
		const { host, foreignWrites, setLocal } = tickHost({
			global: "live",
			addon: "live",
			foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
		});
		await bootThenArm(host, setLocal, pvChargeInput());
		await tickEvExecution(host, pvChargeInput());
		assert.equal(foreignWrites.length, 1);
		setLocal(WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestDisarm, true, false);
		const s = await tickEvExecution(host, pvChargeInput(NOW + EV_FEEDBACK_TIMEOUT_MS));
		assert.equal(foreignWrites.length, 1);
		assert.equal(s.lastResult, "live_test_disarmed");
		assert.equal(peekEvLiveTestState().consumed, true);
		assert.equal(peekEvLiveTestState().retriesBlocked, true);
	});

	it("L14: restart → armed=false and persisted true is not reconstructed", async () => {
		const { host, foreignWrites, setLocal } = tickHost({
			global: "live",
			addon: "live",
			foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
		});
		replaceEvLiveTestState(armEvLiveTest(NOW));
		setLocal(WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestArmed, true, true);
		resetEvExecutionSession();
		const s = await tickEvExecution(host, pvChargeInput());
		assert.equal(foreignWrites.length, 0);
		assert.equal(peekEvLiveTestState().armed, false);
		assert.equal(peekEvLiveTestState().consumed, false);
		assert.equal((await host.getStateAsync(WALLBOX_EV_FOUNDATION_STATES.evExecutionLiveTestArmed))?.val, false);
		assert.equal(s.blockReason, "feature_gate");
	});

	it("L15: consumed test does not emit automatic release-OFF as a second command", async () => {
		const { host, foreignWrites, setLocal, foreign } = tickHost({
			global: "live",
			addon: "live",
			foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
		});
		await bootThenArm(host, setLocal, pvChargeInput());
		await tickEvExecution(host, pvChargeInput());
		foreign[`${LP}.status.mode`] = { val: "pv", ts: NOW + 20_000 };
		await tickEvExecution(host, pvChargeInput(NOW + 20_000, "pv"));
		assert.equal(peekEvExecutionSession().ownership, "ems");
		const after = await tickEvExecution(host, noSlotOwnedInput(NOW + 30_000, "pv"));
		assert.equal(foreignWrites.some((w) => w.id === `${LP}.control.off`), false);
		assert.equal(foreignWrites.length, 1);
		assert.equal(after.releaseReason, "release_off");
		assert.match(after.explain, /live_test=consumed/);
	});

	it("L16: manual EVCC change is not recaptured after consume", async () => {
		const { host, foreignWrites, setLocal, foreign } = tickHost({
			global: "live",
			addon: "live",
			foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
		});
		await bootThenArm(host, setLocal, pvChargeInput());
		await tickEvExecution(host, pvChargeInput());
		foreign[`${LP}.status.mode`] = { val: "pv", ts: NOW + 20_000 };
		await tickEvExecution(host, pvChargeInput(NOW + 20_000, "pv"));
		assert.equal(peekEvExecutionSession().ownership, "ems");
		foreign[`${LP}.status.mode`] = { val: "now", ts: NOW + 40_000 };
		const s = await tickEvExecution(host, pvChargeInput(NOW + 40_000, "now"));
		assert.equal(s.ownership, "none");
		assert.equal(s.releaseReason, "actual_mode_changed_externally");
		assert.equal(foreignWrites.length, 1);
	});

	it("L17: ownership is granted only after confirmed feedback", async () => {
		const { host, foreignWrites, setLocal, foreign } = tickHost({
			global: "live",
			addon: "live",
			foreign: { [`${LP}.status.mode`]: { val: "off", ts: NOW } },
		});
		await bootThenArm(host, setLocal, pvChargeInput());
		const sent = await tickEvExecution(host, pvChargeInput());
		assert.equal(sent.ownership, "unknown");
		assert.equal(foreignWrites.length, 1);
		foreign[`${LP}.status.mode`] = { val: "pv", ts: NOW + 18_000 };
		const confirmed = await tickEvExecution(host, pvChargeInput(NOW + 20_000, "pv"));
		assert.equal(confirmed.ownership, "ems");
		assert.equal(confirmed.ownedMode, "pv");
		assert.equal(confirmed.explain, "live_test=consumed, command=pv, feedback=confirmed");
		assert.equal(foreignWrites.length, 1);
	});

	it("L18: no go-e / Ford / Tibber / Sonnen direct write", () => {
		const writeSrc = readFileSync(join(SRC, "ev_foundation", "execution", "write.ts"), "utf8");
		const tickSrc = readFileSync(join(SRC, "ev_foundation", "execution", "tick.ts"), "utf8");
		const liveSrc = readFileSync(join(SRC, "ev_foundation", "execution", "live_test.ts"), "utf8");
		for (const src of [writeSrc, tickSrc, liveSrc]) {
			assert.equal(/setForeignStateAsync\(\s*["'`]go-e\./.test(src), false);
			assert.equal(/setForeignStateAsync\(\s*["'`]ford/.test(src), false);
			assert.equal(/writeForeignIfChanged\([\s\S]*["'`]sonnen\./.test(src), false);
			assert.equal(/writeForeignIfChanged\([\s\S]*["'`]tibber\./i.test(src), false);
		}
		assert.equal(isAllowedEvccButtonWriteTarget("go-e.0.allow_charging", "now"), false);
		assert.equal(isAllowedEvccButtonWriteTarget("fordpass.0.startCharge", "pv"), false);
	});

	it("L19: legacy pvControl stays excluded even with live-test permit", async () => {
		const pvControlCfg = {
			...BUTTON_CFG,
			wb_evcc_mode_control: "pv_control",
			wb_evcc_control_pv_control_target: `${LP}.control.pvControl`,
		};
		const writes: string[] = [];
		const r = await executeEvccButtonWrite(
			{
				async getForeignStateAsync() {
					return { val: 1 } as ioBroker.State;
				},
				async setForeignStateAsync(id) {
					writes.push(id);
				},
			},
			{
				contract: resolveEvccModeControlContract(pvControlCfg),
				mode: "pv",
				writeAllowed: true,
				liveTestPermit: true,
			},
		);
		assert.equal(r.written, false);
		assert.equal(r.reason, "legacy_variant_blocked");
		assert.equal(writes.length, 0);
		assert.equal(isAllowedEvccButtonWriteTarget(`${LP}.control.pvControl`, "pv"), false);
	});

	it("L20: one-shot consume is the first successful button pulse, not feedback", () => {
		const armed = armEvLiveTest(NOW);
		const permit = evaluateEvLiveTestPermit({ liveTest: armed, desiredMode: "pv" });
		assert.equal(permit.permit, true);
		assert.equal(permit.consumeOnSuccessfulWrite, true);
		const consumed = consumeEvLiveTest(armed, "pv", NOW);
		assert.equal(consumed.consumed, true);
		assert.equal(consumed.armed, false);
		const retryPermit = evaluateEvLiveTestPermit({
			liveTest: consumed,
			desiredMode: "pv",
			pendingMode: "pv",
			pendingActive: true,
		});
		assert.equal(retryPermit.permit, true);
		assert.equal(retryPermit.consumeOnSuccessfulWrite, false);
		assert.equal(
			evaluateEvLiveTestPermit({ liveTest: consumed, desiredMode: "pv", pendingActive: false }).permit,
			false,
		);
		const nextPermit = evaluateEvLiveTestPermit({ liveTest: consumed, desiredMode: "now" });
		assert.equal(nextPermit.permit, false);
		assert.equal(nextPermit.blockReason, "live_test_consumed");
		const disarmed = disarmEvLiveTest(consumed);
		assert.equal(disarmed.retriesBlocked, true);
		assert.equal(evaluateEvLiveTestPermit({ liveTest: disarmed, desiredMode: "pv" }).permit, false);
	});

	it("explain covers the Phase-5B live-test contract", () => {
		assert.equal(
			formatEvExecutionExplain({
				desired: "pv",
				actual: "off",
				authority: "ems",
				phase: "idle",
				blockReason: "",
				failsafeReason: "",
				writeAllowed: true,
				liveTestArmed: true,
			}),
			"live_test=armed, desired=pv, waiting_for_execution",
		);
		assert.equal(
			formatEvExecutionExplain({
				desired: "noop",
				actual: "pv",
				authority: "ems",
				phase: "idle",
				blockReason: "",
				failsafeReason: "",
				writeAllowed: false,
				liveTestArmed: true,
			}),
			"live_test=armed, desired=noop, no_command_sent",
		);
		assert.equal(
			formatEvExecutionExplain({
				desired: "pv",
				actual: "off",
				authority: "external",
				phase: "idle",
				blockReason: "external_authority",
				failsafeReason: "",
				writeAllowed: false,
				liveTestArmed: true,
			}),
			"live_test=armed, authority=external, blocked",
		);
		assert.equal(
			formatEvExecutionExplain({
				desired: "pv",
				actual: "off",
				authority: "ems",
				phase: "awaiting_feedback",
				blockReason: "",
				failsafeReason: "",
				writeAllowed: true,
				liveTestConsumed: true,
				liveTestCommand: "pv",
			}),
			"live_test=consumed, command=pv, awaiting_feedback",
		);
		assert.equal(
			formatEvExecutionExplain({
				desired: "pv",
				actual: "pv",
				authority: "ems",
				phase: "confirmed",
				blockReason: "",
				failsafeReason: "",
				writeAllowed: false,
				liveTestConsumed: true,
				liveTestCommand: "pv",
			}),
			"live_test=consumed, command=pv, feedback=confirmed",
		);
		assert.equal(
			formatEvExecutionExplain({
				desired: "pv",
				actual: "off",
				authority: "ems",
				phase: "failsafe",
				blockReason: "feedback_timeout",
				failsafeReason: "feedback_timeout",
				writeAllowed: false,
				liveTestConsumed: true,
				liveTestCommand: "pv",
			}),
			"live_test=consumed, command=pv, feedback=failed",
		);
	});

	it("empty live-test state is the restart default", () => {
		const empty = emptyEvLiveTestState();
		assert.equal(empty.armed, false);
		assert.equal(empty.consumed, false);
		assert.equal(empty.command, null);
	});
});
