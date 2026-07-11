import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import {
	evaluateWallboxDispatchReadiness,
	powerToTargetCurrentA,
	resetWallboxDispatchCache,
	runWallboxDryrunDispatch,
	WALLBOX_AC_VOLTAGE_V,
} from "./dispatch.js";

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

function allocationEntry(allocatedPowerW: number | null, energySource: DailyAllocationEntry["energySource"] = "grid") {
	return {
		contributionId: CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
		contributor: addonContributorRef("wallbox"),
		slot: { startIso: SLOT_START, endIso: SLOT_END },
		status: "allocated" as const,
		energySource,
		requestedPowerW: allocatedPowerW,
		allocatedPowerW,
		requestedEnergyKwh: null,
		allocatedEnergyKwh: allocatedPowerW !== null ? (allocatedPowerW * 0.25) / 1000 : null,
		gridPowerW: energySource === "pv_surplus" ? 0 : (allocatedPowerW ?? 0),
		pvPowerW: energySource === "pv_surplus" ? (allocatedPowerW ?? 0) : 0,
		mandatory: false,
		priorityRank: 1,
		deadlineIso: DEADLINE,
		estimatedCostCt: 12,
		reasonDe: "test",
	};
}

function planDecision(entries: DailyAllocationEntry[], tel = telemetry()): WallboxPlanDecision {
	return evaluateWallboxDailyPlan({
		now: NOW,
		timezone: TZ,
		meta: { status: "ready", date: "2026-07-11", revision: 3, validUntil: null, timezone: TZ },
		entries,
		telemetry: tel,
		governanceEnabled: true,
		addonEnabled: true,
		vehicleCapacityKwh: 60,
	});
}

function dryrun(entries: DailyAllocationEntry[], tel = telemetry(), config: Record<string, unknown> = {}) {
	const decision = planDecision(entries, tel);
	const intent = buildWallboxDispatchIntent({
		decision,
		governanceEnabled: true,
		addonEnabled: true,
		phases: tel.activePhases ?? tel.configuredPhases,
		now: NOW,
	});
	return runWallboxDryrunDispatch({
		intent,
		decision,
		telemetry: tel,
		config,
		chargingEnabled: false,
		governanceEnabled: true,
	});
}

describe("wallbox power to current", () => {
	it("single phase conversion", () => {
		const r = powerToTargetCurrentA(1380, 1, 6, 16);
		assert.equal(r.currentA, 6);
	});

	it("three phase conversion uses active phases", () => {
		const r = powerToTargetCurrentA(4140, 3, 6, 16);
		assert.equal(r.currentA, 6);
	});

	it("below minimum current returns null", () => {
		const r = powerToTargetCurrentA(500, 1, 6, 16);
		assert.equal(r.currentA, null);
	});

	it("exact minimum power", () => {
		const minW = 1 * WALLBOX_AC_VOLTAGE_V * 6;
		const r = powerToTargetCurrentA(minW, 1, 6, 16);
		assert.equal(r.currentA, 6);
	});

	it("caps at maximum current", () => {
		const r = powerToTargetCurrentA(10000, 1, 6, 16);
		assert.equal(r.currentA, 16);
	});

	it("missing phases returns null", () => {
		const r = powerToTargetCurrentA(3600, null, 6, 16);
		assert.equal(r.currentA, null);
	});

	it("integer amp steps", () => {
		const r = powerToTargetCurrentA(1500, 1, 6, 16);
		assert.equal(r.currentA, 7);
	});
});

describe("wallbox dispatch readiness", () => {
	it("complete legacy mapping", () => {
		const r = evaluateWallboxDispatchReadiness({
			wb_set_enabled_target: "go-e.0.allow_charging",
			wb_set_current_a_target: "go-e.0.ampere",
		});
		assert.equal(r.controlMappingComplete, true);
		assert.equal(r.enableMappingAvailable, true);
		assert.equal(r.currentMappingAvailable, true);
		assert.equal(r.liveDispatchSupported, false);
	});

	it("enable missing", () => {
		const r = evaluateWallboxDispatchReadiness({ wb_set_current_a_target: "go-e.0.ampere" });
		assert.equal(r.enableMappingAvailable, false);
		assert.equal(r.controlMappingComplete, false);
		assert.ok(r.missingMappings.includes("set_enabled"));
	});

	it("current missing without power alternative", () => {
		const r = evaluateWallboxDispatchReadiness({ wb_set_enabled_target: "go-e.0.allow_charging" });
		assert.equal(r.currentMappingAvailable, false);
		assert.equal(r.powerMappingAvailable, false);
		assert.ok(r.missingMappings.some((m) => m.includes("set_current")));
	});

	it("power mapping as alternative", () => {
		const r = evaluateWallboxDispatchReadiness({
			wb_set_enabled_target: "go-e.0.allow_charging",
			wb_set_charge_power_w_target: "go-e.0.power",
		});
		assert.equal(r.powerMappingAvailable, true);
		assert.equal(r.controlMappingComplete, true);
	});

	it("live dispatch always false in v0.1.133", () => {
		const r = evaluateWallboxDispatchReadiness({
			wb_set_enabled_target: "x",
			wb_set_current_a_target: "y",
		});
		assert.equal(r.liveDispatchSupported, false);
		assert.equal(r.modeMappingAvailable, false);
	});
});

describe("wallbox dryrun dispatch", () => {
	beforeEach(() => resetWallboxDispatchCache());

	it("charge produces target current and dryrun command", () => {
		const r = dryrun([allocationEntry(3600)]);
		assert.equal(r.dispatchStatus, "charge_planned");
		assert.equal(r.target.action, "charge");
		assert.equal(r.target.enableCharging, true);
		assert.equal(r.target.targetPowerW, 3600);
		assert.equal(r.target.targetCurrentA, 16);
		assert.equal(r.target.desiredEvccMode, null);
		assert.match(r.dispatchReasonDe, /Dryrun-Ziel/);
		assert.match(r.dispatchReasonDe, /kein EVCC-Kommando/);
		assert.ok(r.dryrunCommand.some((c) => c.role === "set_current_a"));
	});

	it("caps power at technical maximum", () => {
		const tel = telemetry({ activePhases: 1, minCurrentA: 6, maxCurrentA: 10 });
		const r = dryrun([allocationEntry(10000)], tel);
		assert.equal(r.target.targetPowerW, 2300);
		assert.equal(r.target.targetCurrentA, 10);
	});

	it("missing phases yields hold at plan level", () => {
		const r = dryrun(
			[allocationEntry(3600)],
			telemetry({ activePhases: null, configuredPhases: null }),
		);
		assert.equal(r.dispatchStatus, "hold");
		assert.equal(r.intent.action, "hold");
	});

	it("deadline at risk still allows charge", () => {
		const entry = allocationEntry(3600);
		const decision = planDecision([entry]);
		decision.deadlineReachable = false;
		const intent = buildWallboxDispatchIntent({
			decision,
			governanceEnabled: true,
			addonEnabled: true,
			phases: 1,
			now: NOW,
		});
		const r = runWallboxDryrunDispatch({
			intent,
			decision,
			telemetry: telemetry(),
			config: {},
			chargingEnabled: false,
			governanceEnabled: true,
		});
		assert.equal(r.deadlineStatus, "at_risk");
		assert.equal(r.target.action, "charge");
		assert.match(r.target.reasonDe, /Deadline/);
	});

	it("disconnected produces none and empty dryrun command", () => {
		const r = dryrun([allocationEntry(3600)], telemetry({ connected: false }));
		assert.equal(r.dispatchStatus, "none");
		assert.equal(r.dryrunCommand.length, 0);
	});

	it("hold produces dryrun disable intent", () => {
		const r = dryrun([]);
		assert.equal(r.dispatchStatus, "hold");
		assert.equal(r.target.enableCharging, false);
	});

	it("cache returns same result without recalculation", () => {
		const first = dryrun([allocationEntry(3600)]);
		const second = dryrun([allocationEntry(3600)]);
		assert.equal(first, second);
	});

	it("cache resets on revision change", () => {
		const first = dryrun([allocationEntry(3600)]);
		resetWallboxDispatchCache();
		const decision = planDecision([allocationEntry(3600)]);
		decision.dailyPlanRevision = 99;
		const intent = buildWallboxDispatchIntent({
			decision,
			governanceEnabled: true,
			addonEnabled: true,
			phases: 1,
			now: NOW,
		});
		const second = runWallboxDryrunDispatch({
			intent,
			decision,
			telemetry: telemetry(),
			config: {},
			chargingEnabled: false,
			governanceEnabled: true,
		});
		assert.notEqual(first.intent.dailyPlanRevision, second.intent.dailyPlanRevision);
	});

	it("mixed source is preserved", () => {
		const r = dryrun([allocationEntry(3600, "mixed")]);
		assert.equal(r.target.source, "mixed");
	});

	it("dispatch source has no failsafe or foreign write imports", () => {
		const src = readFileSync(
			join(process.cwd(), "src/addons/wallbox/runtime/dispatch.ts"),
			"utf8",
		);
		assert.ok(!src.includes("failsafe"));
		assert.ok(!src.includes("writeForeignIfChanged"));
		assert.ok(!src.includes("setForeignState"));
		const r = dryrun([allocationEntry(3600)], telemetry(), {
			wb_set_enabled_target: "go-e.0.allow_charging",
			wb_set_current_a_target: "go-e.0.ampere",
		});
		assert.equal(r.readiness.controlMappingComplete, true);
		assert.equal(r.readiness.liveDispatchSupported, false);
	});
});
