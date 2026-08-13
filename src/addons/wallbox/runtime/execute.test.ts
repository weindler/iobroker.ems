import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTRIBUTION_IDS } from "../../../operator/contribution_ids";
import { addonContributorRef } from "../../../operator/contributor";
import { slotStartIsoFloored, DAILY_PLAN_SLOT_MS } from "../../../operator/daily_plan/slots";
import { isoFromMs } from "../../../operator/time";
import { evaluateWallboxDailyPlan, type WallboxTelemetryInput } from "./daily_plan.js";
import { buildWallboxDispatchIntent } from "./intent.js";
import { runWallboxDryrunDispatch } from "./dispatch.js";
import { type WallboxCommandCandidate } from "./command.js";
import { buildWallboxControlMappingSnapshot } from "./control_mapping.js";
import type { WallboxControlObjectMeta } from "./control_object_meta.js";
import { buildWallboxWritePlan } from "./write_plan.js";
import {
	executeWallboxWrite,
	runWallboxLiveFoundation,
	resolveWallboxRuntimePhase,
	WALLBOX_LIVE_WRITE_RELEASED,
	type WallboxWriteHost,
} from "./execute.js";

const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = slotStartIsoFloored(NOW, "UTC");
const SLOT_END = isoFromMs(Date.parse(SLOT_START) + DAILY_PLAN_SLOT_MS);

function testMapping() {
	return buildWallboxControlMappingSnapshot({
		config: {
			wb_control_model: "legacy_direct",
			wb_set_enabled_target: "go-e.0.allow_charging",
			wb_set_enabled_enabled: true,
			wb_set_current_a_target: "go-e.0.amperePV",
			wb_set_current_a_enabled: true,
		},
		telemetryCfg: {
			enabledStateId: "evcc.0.enabled",
			maxCurrentAStateId: "",
			modeReadbackStateId: "",
		},
		objectMetas: {
			"go-e.0.allow_charging": {
				stateId: "go-e.0.allow_charging",
				objectPresent: true,
				writable: true,
				readable: true,
				commonType: "boolean",
				allowedStateKeys: null,
			},
			"go-e.0.amperePV": {
				stateId: "go-e.0.amperePV",
				objectPresent: true,
				writable: true,
				readable: true,
				commonType: "number",
				allowedStateKeys: null,
			},
		},
	});
}

const EVCC_MODE = "evcc.0.loadpoint.1.mode";
const EVCC_MAX_CURRENT = "evcc.0.loadpoint.1.maxCurrent";
const MODE_STATES = ["pv", "off", "now"];

function meta(
	id: string,
	commonType: "boolean" | "number" | "string",
	writable = true,
	allowedStateKeys: string[] | null = null,
): WallboxControlObjectMeta {
	return { stateId: id, objectPresent: true, writable, readable: true, commonType, allowedStateKeys };
}

function testEvccMapping() {
	return buildWallboxControlMappingSnapshot({
		config: {
			wb_control_model: "evcc",
			wb_evcc_set_mode_target: EVCC_MODE,
			wb_evcc_set_max_current_a_target: EVCC_MAX_CURRENT,
			wb_evcc_mode_charge_value: "pv",
			wb_evcc_mode_hold_value: "off",
		},
		telemetryCfg: {
			enabledStateId: "evcc.0.loadpoint.1.enabled",
			maxCurrentAStateId: "evcc.0.telemetry.maxCurrent",
			modeReadbackStateId: EVCC_MODE,
		},
		objectMetas: {
			[EVCC_MODE]: meta(EVCC_MODE, "string", true, MODE_STATES),
			[EVCC_MAX_CURRENT]: meta(EVCC_MAX_CURRENT, "number"),
		},
	});
}

function chargeWritePlan(c: WallboxCommandCandidate = chargeCandidate(), chargingEnabled = false) {
	return buildWallboxWritePlan({
		candidate: c,
		mapping: testMapping(),
		chargingEnabled,
		chargeModeActive: null,
		now: NOW,
	});
}

function evccChargeWritePlan(
	c: WallboxCommandCandidate = chargeCandidate(),
	chargeModeActive: boolean | null = false,
) {
	return buildWallboxWritePlan({
		candidate: c,
		mapping: testEvccMapping(),
		chargingEnabled: null,
		chargeModeActive,
		now: NOW,
	});
}

function chargeCandidate(over: Partial<WallboxCommandCandidate> = {}): WallboxCommandCandidate {
	return {
		action: "charge",
		targetPowerW: 3600,
		targetCurrentA: 16,
		energySource: "grid",
		connected: true,
		technicallyReady: true,
		dispatchRevision: 1,
		planRevision: 1,
		createdAt: NOW.toISOString(),
		blocked: false,
		blockReason: null,
		...over,
	};
}

function mockHost(overrides: Partial<WallboxWriteHost> = {}): WallboxWriteHost & {
	writes: Array<{ id: string; val: unknown }>;
} {
	const writes: Array<{ id: string; val: unknown }> = [];
	return {
		writes,
		getForeignStateAsync: async () => null,
		setForeignStateAsync: async (id, st) => {
			writes.push({ id, val: typeof st === "object" && st !== null ? (st as ioBroker.SettableState).val : st });
		},
		log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
		...overrides,
	};
}

function fullDispatch() {
	const tel: WallboxTelemetryInput = {
		connected: true,
		charging: false,
		vehicleSocPct: 40,
		planSocPct: 80,
		planActive: false,
		sessionEnergyKwh: 5,
		effectivePlanTime: "2026-07-11T14:00:00.000Z",
		planTime: "2026-07-11T14:00:00.000Z",
		activePhases: 1,
		configuredPhases: 3,
		minCurrentA: 6,
		maxCurrentA: 16,
		chargePowerW: null,
		evccConfigured: true,
		mappingsReady: true,
	};
	const entry = {
		contributionId: CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
		contributor: addonContributorRef("wallbox"),
		slot: { startIso: SLOT_START, endIso: SLOT_END },
		status: "allocated" as const,
		energySource: "grid" as const,
		requestedPowerW: 3600,
		allocatedPowerW: 3600,
		requestedEnergyKwh: null,
		allocatedEnergyKwh: 0.9,
		gridPowerW: 3600,
		pvPowerW: 0,
		mandatory: false,
		priorityRank: 1,
		deadlineIso: "2026-07-11T14:00:00.000Z",
		estimatedCostCt: 12,
		reasonDe: "test",
	};
	const decision = evaluateWallboxDailyPlan({
		now: NOW,
		timezone: "UTC",
		meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: "UTC" },
		entries: [entry],
		telemetry: tel,
		governanceEnabled: true,
		addonEnabled: true,
	});
	const intent = buildWallboxDispatchIntent({
		decision,
		governanceEnabled: true,
		addonEnabled: true,
		phases: 1,
		now: NOW,
	});
	return runWallboxDryrunDispatch({
		intent,
		decision,
		telemetry: tel,
		config: { wb_control_model: "legacy_direct", wb_set_enabled_target: "x", wb_set_current_a_target: "y" },
		chargingEnabled: false,
		governanceEnabled: true,
	});
}

describe("wallbox runtime phase", () => {
	it("observe when governance off", () => {
		assert.equal(
			resolveWallboxRuntimePhase({ addonEnabled: true, governanceEnabled: false, liveRequested: true }),
			"observe",
		);
	});

	it("dryrun when live not requested", () => {
		assert.equal(
			resolveWallboxRuntimePhase({ addonEnabled: true, governanceEnabled: true, liveRequested: false }),
			"dryrun",
		);
	});

	it("live when live requested and governance on", () => {
		assert.equal(
			resolveWallboxRuntimePhase({ addonEnabled: true, governanceEnabled: true, liveRequested: true }),
			"live",
		);
	});
});

describe("executeWallboxWrite", () => {
	it("release gate is open (v0.1.176, gated by liveEligible/fault/ownership)", () => {
		assert.equal(WALLBOX_LIVE_WRITE_RELEASED, true);
	});

	it("observe does not attempt execution", async () => {
		const r = await executeWallboxWrite(mockHost(), {
			candidate: chargeCandidate(),
			writePlan: null,
			phase: "observe",
			liveRequested: false,
		});
		assert.equal(r.attempted, false);
		assert.equal(r.reason, "observe_mode");
	});

	it("dryrun blocks without execution gate", async () => {
		const r = await executeWallboxWrite(mockHost(), {
			candidate: chargeCandidate(),
			writePlan: chargeWritePlan(),
			phase: "dryrun",
			liveRequested: false,
		});
		assert.equal(r.reason, "execution_gate_closed");
	});

	it("live with blocked candidate stops before write plan", async () => {
		const r = await executeWallboxWrite(mockHost(), {
			candidate: chargeCandidate({ blocked: true, blockReason: "vehicle_disconnected" }),
			writePlan: null,
			phase: "live",
			liveRequested: true,
		});
		assert.equal(r.reason, "vehicle_disconnected");
	});

	it("active fault/lockout blocks live writes", async () => {
		const host = mockHost();
		const r = await executeWallboxWrite(host, {
			candidate: chargeCandidate(),
			writePlan: evccChargeWritePlan(),
			phase: "live",
			liveRequested: true,
			faultActive: true,
		});
		assert.equal(r.reason, "fault_lockout");
		assert.equal(host.writes.length, 0);
	});

	it("legacy_direct control model never executes (structurally not live-eligible)", async () => {
		const host = mockHost();
		const plan = chargeWritePlan();
		assert.equal(plan.liveEligible, false, "legacy_direct plans are never live-eligible");
		const r = await executeWallboxWrite(host, {
			candidate: chargeCandidate(),
			writePlan: plan,
			phase: "live",
			liveRequested: true,
		});
		assert.equal(r.executed, false);
		assert.equal(r.blocked, true);
		assert.equal(host.writes.length, 0);
	});

	it("live EVCC charge_start writes maxCurrent then mode in sequence order", async () => {
		const host = mockHost();
		const plan = evccChargeWritePlan(chargeCandidate(), false);
		assert.equal(plan.liveEligible, true, "evcc plan with confirmed mapping must be live-eligible");
		assert.equal(plan.writeScenario, "charge_start");
		const r = await executeWallboxWrite(host, {
			candidate: chargeCandidate(),
			writePlan: plan,
			phase: "live",
			liveRequested: true,
		});
		assert.equal(r.attempted, true);
		assert.equal(r.executed, true);
		assert.equal(r.blocked, false);
		assert.equal(r.ownershipGranted, true);
		assert.ok(typeof r.writeTimestampMs === "number");
		assert.equal(host.writes.length, 2);
		assert.equal(host.writes[0].id, EVCC_MAX_CURRENT);
		assert.equal(host.writes[0].val, 16);
		assert.equal(host.writes[1].id, EVCC_MODE);
		assert.equal(host.writes[1].val, "pv");
	});

	it("live EVCC charge_adjust (already in charge mode) writes only maxCurrent", async () => {
		const host = mockHost();
		const plan = evccChargeWritePlan(chargeCandidate(), true);
		assert.equal(plan.writeScenario, "charge_adjust");
		const r = await executeWallboxWrite(host, {
			candidate: chargeCandidate(),
			writePlan: plan,
			phase: "live",
			liveRequested: true,
		});
		assert.equal(r.executed, true);
		assert.equal(host.writes.length, 1);
		assert.equal(host.writes[0].id, EVCC_MAX_CURRENT);
	});

	it("write already at target is executed without a real write (skipped)", async () => {
		const host = mockHost({
			getForeignStateAsync: async (id) => {
				if (id === EVCC_MAX_CURRENT) return { val: 16 } as ioBroker.State;
				return null;
			},
		});
		const plan = evccChargeWritePlan(chargeCandidate(), true);
		const r = await executeWallboxWrite(host, {
			candidate: chargeCandidate(),
			writePlan: plan,
			phase: "live",
			liveRequested: true,
		});
		assert.equal(r.executed, true);
		assert.equal(r.reason, "already_at_target");
		assert.equal(host.writes.length, 0);
	});

	it("write failure blocks with write_failed and grants no ownership", async () => {
		const host = mockHost({
			setForeignStateAsync: async () => {
				throw new Error("bus down");
			},
		});
		const plan = evccChargeWritePlan(chargeCandidate(), false);
		const r = await executeWallboxWrite(host, {
			candidate: chargeCandidate(),
			writePlan: plan,
			phase: "live",
			liveRequested: true,
		});
		assert.equal(r.executed, false);
		assert.equal(r.blocked, true);
		assert.equal(r.reason, "write_failed");
		assert.equal(r.ownershipGranted, false);
	});
});

describe("runWallboxLiveFoundation", () => {
	it("observe skips candidate and execution", async () => {
		const dispatch = fullDispatch();
		const decision = evaluateWallboxDailyPlan({
			now: NOW,
			timezone: "UTC",
			meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: "UTC" },
			entries: [],
			telemetry: {
				connected: true,
				charging: false,
				vehicleSocPct: 40,
				planSocPct: 80,
				planActive: false,
				sessionEnergyKwh: 5,
				effectivePlanTime: null,
				planTime: null,
				activePhases: 1,
				configuredPhases: 3,
				minCurrentA: 6,
				maxCurrentA: 16,
				chargePowerW: null,
				evccConfigured: true,
				mappingsReady: true,
			},
			governanceEnabled: false,
			addonEnabled: true,
		});
		const r = await runWallboxLiveFoundation(mockHost(), {
			dispatch,
			decision,
			mappingSnapshot: testMapping(),
			chargingEnabled: false,
			chargeModeActive: null,
			config: {},
			addonEnabled: true,
			governanceEnabled: false,
			liveRequested: true,
			now: NOW,
		});
		assert.equal(r.phase, "observe");
		assert.equal(r.candidate, null);
		assert.equal(r.writePlan, null);
		assert.equal(r.feedbackContract, null);
		assert.equal(r.writeResult, null);
		assert.equal(r.writeAllowed, false);
	});

	it("dryrun builds candidate without execution result", async () => {
		const dispatch = fullDispatch();
		const decision = evaluateWallboxDailyPlan({
			now: NOW,
			timezone: "UTC",
			meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: "UTC" },
			entries: [{
				contributionId: CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
				contributor: addonContributorRef("wallbox"),
				slot: { startIso: SLOT_START, endIso: SLOT_END },
				status: "allocated",
				energySource: "grid",
				requestedPowerW: 3600,
				allocatedPowerW: 3600,
				requestedEnergyKwh: null,
				allocatedEnergyKwh: 0.9,
				gridPowerW: 3600,
				pvPowerW: 0,
				mandatory: false,
				priorityRank: 1,
				deadlineIso: "2026-07-11T14:00:00.000Z",
				estimatedCostCt: 12,
				reasonDe: "test",
			}],
			telemetry: {
				connected: true,
				charging: false,
				vehicleSocPct: 40,
				planSocPct: 80,
				planActive: false,
				sessionEnergyKwh: 5,
				effectivePlanTime: "2026-07-11T14:00:00.000Z",
				planTime: "2026-07-11T14:00:00.000Z",
				activePhases: 1,
				configuredPhases: 3,
				minCurrentA: 6,
				maxCurrentA: 16,
				chargePowerW: null,
				evccConfigured: true,
				mappingsReady: true,
			},
			governanceEnabled: true,
			addonEnabled: true,
		});
		const r = await runWallboxLiveFoundation(mockHost(), {
			dispatch,
			decision,
			mappingSnapshot: testMapping(),
			chargingEnabled: false,
			chargeModeActive: null,
			config: {},
			addonEnabled: true,
			governanceEnabled: true,
			liveRequested: false,
			now: NOW,
		});
		assert.equal(r.phase, "dryrun");
		assert.ok(r.candidate);
		assert.ok(r.writePlan);
		assert.ok(r.feedbackContract);
		assert.equal(r.writeResult, null);
	});

	it("live with legacy_direct mapping blocks at liveEligible gate (structural)", async () => {
		const dispatch = fullDispatch();
		const decision = evaluateWallboxDailyPlan({
			now: NOW,
			timezone: "UTC",
			meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: "UTC" },
			entries: [{
				contributionId: CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
				contributor: addonContributorRef("wallbox"),
				slot: { startIso: SLOT_START, endIso: SLOT_END },
				status: "allocated",
				energySource: "grid",
				requestedPowerW: 3600,
				allocatedPowerW: 3600,
				requestedEnergyKwh: null,
				allocatedEnergyKwh: 0.9,
				gridPowerW: 3600,
				pvPowerW: 0,
				mandatory: false,
				priorityRank: 1,
				deadlineIso: "2026-07-11T14:00:00.000Z",
				estimatedCostCt: 12,
				reasonDe: "test",
			}],
			telemetry: {
				connected: true,
				charging: false,
				vehicleSocPct: 40,
				planSocPct: 80,
				planActive: false,
				sessionEnergyKwh: 5,
				effectivePlanTime: "2026-07-11T14:00:00.000Z",
				planTime: "2026-07-11T14:00:00.000Z",
				activePhases: 1,
				configuredPhases: 3,
				minCurrentA: 6,
				maxCurrentA: 16,
				chargePowerW: null,
				evccConfigured: true,
				mappingsReady: true,
			},
			governanceEnabled: true,
			addonEnabled: true,
		});
		const host = mockHost();
		const r = await runWallboxLiveFoundation(host, {
			dispatch,
			decision,
			mappingSnapshot: testMapping(),
			chargingEnabled: false,
			chargeModeActive: null,
			config: {},
			addonEnabled: true,
			governanceEnabled: true,
			liveRequested: true,
			now: NOW,
		});
		assert.equal(r.phase, "live");
		assert.ok(r.candidate?.technicallyReady);
		assert.ok(r.writePlan?.contractReady);
		assert.equal(r.writePlan?.liveEligible, false);
		assert.equal(r.writeResult?.attempted, false);
		assert.equal(r.writeAllowed, false);
		assert.equal(host.writes.length, 0);
	});
});
