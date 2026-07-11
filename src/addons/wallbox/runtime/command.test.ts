import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTRIBUTION_IDS } from "../../../operator/contribution_ids";
import { addonContributorRef } from "../../../operator/contributor";
import type { DailyAllocationEntry } from "../../../operator/daily_plan/types";
import { slotStartIsoFloored, DAILY_PLAN_SLOT_MS } from "../../../operator/daily_plan/slots";
import { isoFromMs } from "../../../operator/time";
import {
	evaluateWallboxDailyPlan,
	type WallboxTelemetryInput,
	type WallboxPlanDecision,
} from "./daily_plan.js";
import { buildWallboxDispatchIntent } from "./intent.js";
import { runWallboxDryrunDispatch } from "./dispatch.js";
import { buildWallboxCommandCandidate } from "./command.js";

const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = slotStartIsoFloored(NOW, TZ);
const SLOT_END = isoFromMs(Date.parse(SLOT_START) + DAILY_PLAN_SLOT_MS);
const DEADLINE = "2026-07-11T14:00:00.000Z";

function telemetry(over: Partial<WallboxTelemetryInput> = {}): WallboxTelemetryInput {
	return {
		connected: true,
		charging: false,
		vehicleSocPct: 40,
		planSocPct: 80,
		planActive: false,
		sessionEnergyKwh: 5,
		effectivePlanTime: DEADLINE,
		planTime: DEADLINE,
		activePhases: 1,
		configuredPhases: 3,
		minCurrentA: 6,
		maxCurrentA: 16,
		chargePowerW: null,
		evccConfigured: true,
		mappingsReady: true,
		...over,
	};
}

function allocationEntry(allocatedPowerW: number | null) {
	return {
		contributionId: CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
		contributor: addonContributorRef("wallbox"),
		slot: { startIso: SLOT_START, endIso: SLOT_END },
		status: "allocated" as const,
		energySource: "grid" as const,
		requestedPowerW: allocatedPowerW,
		allocatedPowerW,
		requestedEnergyKwh: null,
		allocatedEnergyKwh: allocatedPowerW !== null ? (allocatedPowerW * 0.25) / 1000 : null,
		gridPowerW: allocatedPowerW ?? 0,
		pvPowerW: 0,
		mandatory: false,
		priorityRank: 1,
		deadlineIso: DEADLINE,
		estimatedCostCt: 12,
		reasonDe: "test",
	};
}

function pipeline(entries: DailyAllocationEntry[], tel = telemetry(), config: Record<string, unknown> = {}) {
	const decision = evaluateWallboxDailyPlan({
		now: NOW,
		timezone: TZ,
		meta: { status: "ready", date: "2026-07-11", revision: 4, validUntil: null, timezone: TZ },
		entries,
		telemetry: tel,
		governanceEnabled: true,
		addonEnabled: true,
	});
	const intent = buildWallboxDispatchIntent({
		decision,
		governanceEnabled: true,
		addonEnabled: true,
		phases: tel.activePhases ?? tel.configuredPhases,
		now: NOW,
	});
	const dispatch = runWallboxDryrunDispatch({
		intent,
		decision,
		telemetry: tel,
		config,
		chargingEnabled: false,
		governanceEnabled: true,
	});
	const candidate = buildWallboxCommandCandidate({ dispatch, decision, now: NOW });
	return { decision, dispatch, candidate };
}

describe("wallbox command candidate", () => {
	it("none produces no executable charge", () => {
		const { candidate } = pipeline([], telemetry({ connected: false }));
		assert.equal(candidate.action, "none");
		assert.equal(candidate.technicallyReady, false);
		assert.equal(candidate.blocked, true);
	});

	it("hold produces no positive charge power", () => {
		const { candidate } = pipeline([]);
		assert.equal(candidate.action, "hold");
		assert.equal(candidate.targetPowerW, 0);
		assert.equal(candidate.blocked, true);
		assert.equal(candidate.blockReason, "hold_requested");
	});

	it("valid charge produces neutral candidate", () => {
		const { candidate } = pipeline([allocationEntry(3600)], telemetry(), {
			wb_control_model: "legacy_direct",
			wb_set_enabled_target: "go-e.0.allow_charging",
			wb_set_current_a_target: "go-e.0.ampere",
		});
		assert.equal(candidate.action, "charge");
		assert.equal(candidate.technicallyReady, true);
		assert.equal(candidate.blocked, false);
		assert.equal(candidate.targetPowerW, 3600);
		assert.ok(candidate.targetCurrentA !== null && candidate.targetCurrentA > 0);
	});

	it("charge blocked when disconnected", () => {
		const { candidate } = pipeline([allocationEntry(3600)], telemetry({ connected: false, vehicleSocPct: 0 }));
		assert.equal(candidate.action, "none");
		assert.equal(candidate.blocked, true);
		assert.equal(candidate.blockReason, "vehicle_disconnected");
	});

	it("soc 0 when disconnected is not an error path", () => {
		const { candidate } = pipeline([allocationEntry(3600)], telemetry({ connected: false, vehicleSocPct: 0 }));
		assert.equal(candidate.blockReason, "vehicle_disconnected");
		assert.notEqual(candidate.blockReason, "invalid_target_power");
	});

	it("mapping incomplete sets not ready", () => {
		const { candidate } = pipeline([allocationEntry(3600)], telemetry(), {});
		assert.equal(candidate.technicallyReady, false);
		assert.equal(candidate.blocked, true);
		assert.equal(candidate.blockReason, "mapping_incomplete");
	});

	it("rejects non-finite target power", () => {
		const decision = evaluateWallboxDailyPlan({
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
			entries: [allocationEntry(3600)],
			telemetry: telemetry(),
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
		const dispatch = runWallboxDryrunDispatch({
			intent,
			decision,
			telemetry: telemetry(),
			config: {
				wb_control_model: "legacy_direct",
				wb_set_enabled_target: "x",
				wb_set_current_a_target: "y",
			},
			chargingEnabled: false,
			governanceEnabled: true,
		});
		dispatch.target.targetPowerW = Number.NaN;
		dispatch.intent.action = "charge";
		const candidate = buildWallboxCommandCandidate({ dispatch, decision, now: NOW });
		assert.equal(candidate.technicallyReady, false);
		assert.equal(candidate.blockReason, "invalid_target_power");
	});

	it("rejects negative target current", () => {
		const { decision, dispatch } = pipeline([allocationEntry(3600)], telemetry(), {
			wb_control_model: "legacy_direct",
			wb_set_enabled_target: "x",
			wb_set_current_a_target: "y",
		});
		dispatch.target.targetCurrentA = -1;
		const candidate = buildWallboxCommandCandidate({ dispatch, decision, now: NOW });
		assert.equal(candidate.technicallyReady, false);
		assert.equal(candidate.blockReason, "invalid_target_current");
	});
});
