import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRIBUTION_IDS } from "../../../operator/contribution_ids";
import { addonContributorRef } from "../../../operator/contributor";
import { slotStartIsoFloored, DAILY_PLAN_SLOT_MS } from "../../../operator/daily_plan/slots";
import { isoFromMs } from "../../../operator/time";
import { evaluateWallboxDailyPlan, type WallboxTelemetryInput } from "./daily_plan.js";
import { buildWallboxDispatchIntent } from "./intent.js";
import { runWallboxDryrunDispatch } from "./dispatch.js";
import { type WallboxCommandCandidate } from "./command.js";
import { buildWallboxControlMappingSnapshot } from "./control_mapping.js";
import { buildWallboxWritePlan } from "./write_plan.js";
import {
	executeWallboxWrite,
	runWallboxLiveFoundation,
	resolveWallboxRuntimePhase,
	WALLBOX_LIVE_WRITE_RELEASED,
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
				commonType: "boolean",
				allowedStateKeys: null,
			},
			"go-e.0.amperePV": {
				stateId: "go-e.0.amperePV",
				objectPresent: true,
				writable: true,
				commonType: "number",
				allowedStateKeys: null,
			},
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
	it("never executes external write in v0.1.135", async () => {
		const r = await executeWallboxWrite({
			candidate: chargeCandidate(),
			writePlan: chargeWritePlan(),
			phase: "live",
			liveRequested: true,
		});
		assert.equal(r.attempted, false, "function invocation alone is not an external write attempt");
		assert.equal(r.executed, false);
		assert.equal(r.blocked, true);
		assert.equal(r.reason, "release_gate_closed");
	});

	it("observe does not attempt execution", async () => {
		const r = await executeWallboxWrite({
			candidate: chargeCandidate(),
			writePlan: null,
			phase: "observe",
			liveRequested: false,
		});
		assert.equal(r.attempted, false);
		assert.equal(r.reason, "observe_mode");
	});

	it("dryrun blocks without release gate", async () => {
		const r = await executeWallboxWrite({
			candidate: chargeCandidate(),
			writePlan: chargeWritePlan(),
			phase: "dryrun",
			liveRequested: false,
		});
		assert.equal(r.reason, "execution_gate_closed");
	});

	it("live with blocked candidate stops before release gate", async () => {
		const r = await executeWallboxWrite({
			candidate: chargeCandidate({ blocked: true, blockReason: "vehicle_disconnected" }),
			writePlan: null,
			phase: "live",
			liveRequested: true,
		});
		assert.equal(r.reason, "vehicle_disconnected");
	});

	it("release gate is closed", () => {
		assert.equal(WALLBOX_LIVE_WRITE_RELEASED, false);
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
		const r = await runWallboxLiveFoundation({
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
		const r = await runWallboxLiveFoundation({
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
		assert.notEqual(r.feedbackContract?.status, "pending");
		assert.notEqual(r.feedbackContract?.status, "matched");
		assert.equal(r.writeResult, null);
	});

	it("live routes to execute and blocks at release gate", async () => {
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
		const r = await runWallboxLiveFoundation({
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
		assert.ok(r.feedbackContract);
		assert.equal(r.writeResult?.reason, "release_gate_closed");
		assert.equal(r.writeResult?.attempted, false);
		assert.equal(r.writeAllowed, false);
	});

	it("live does not start feedback timers", async () => {
		const src = readFileSync(join(process.cwd(), "src/addons/wallbox/runtime/execute.ts"), "utf8");
		assert.ok(!src.includes("setTimeout"));
		assert.ok(!src.includes("setInterval"));
	});
});

describe("wallbox execute write safety", () => {
	it("execute module has no foreign write imports", () => {
		const src = readFileSync(join(process.cwd(), "src/addons/wallbox/runtime/execute.ts"), "utf8");
		assert.ok(!/import\s*\{[^}]*writeForeignIfChanged/.test(src));
		assert.ok(!/import\s*\{[^}]*setForeignStateAsync/.test(src));
		assert.ok(!/from\s+["'].*failsafe/.test(src));
		assert.ok(!src.includes("writeForeignIfChanged("));
		assert.ok(!src.includes("setForeignStateAsync("));
	});

	it("write plan module has no foreign write imports", () => {
		const src = readFileSync(join(process.cwd(), "src/addons/wallbox/runtime/write_plan.ts"), "utf8");
		assert.ok(!src.includes("writeForeignIfChanged("));
		assert.ok(!src.includes("setForeignStateAsync("));
	});

	it("valid charge candidate in live still produces zero writes via execute", async () => {
		const r = await executeWallboxWrite({
			candidate: chargeCandidate(),
			writePlan: chargeWritePlan(),
			phase: "live",
			liveRequested: true,
		});
		assert.equal(r.executed, false);
	});
});
