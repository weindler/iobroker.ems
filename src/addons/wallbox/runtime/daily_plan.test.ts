import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CONTRIBUTION_IDS } from "../../../operator/contribution_ids";
import { addonContributorRef } from "../../../operator/contributor";
import type { DailyAllocationEntry } from "../../../operator/daily_plan/types";
import { slotStartIsoFloored, DAILY_PLAN_SLOT_MS } from "../../../operator/daily_plan/slots";
import { isoFromMs } from "../../../operator/time";
import {
	computeRemainingEnergyKwh,
	evaluateWallboxDailyPlan,
	parseDailyAllocationEntries,
	resetWallboxDailyPlanCache,
	resolveWallboxDailyPlanDecision,
	resolveWallboxPowerLimits,
	summarizeWallboxPlanUntilDeadline,
	wallboxMinChargePowerW,
	type WallboxTelemetryInput,
} from "./daily_plan.js";
import type { EvccTelemetrySnapshot } from "../evcc_telemetry.js";
import { emptyEvccTelemetrySnapshot } from "../evcc_telemetry.js";
import type { WallboxEvccTelemetryConfig } from "../evcc_config.js";
import { emptyWallboxEvccTelemetryConfig } from "../evcc_config.js";

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
		planActive: true,
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

function allocationEntry(
	allocatedPowerW: number | null,
	status: DailyAllocationEntry["status"] = "allocated",
	over: Partial<DailyAllocationEntry> = {},
): DailyAllocationEntry {
	return {
		contributionId: CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
		contributor: addonContributorRef("wallbox"),
		slot: { startIso: SLOT_START, endIso: SLOT_END },
		status,
		energySource: "grid",
		requestedPowerW: allocatedPowerW,
		allocatedPowerW,
		requestedEnergyKwh: null,
		allocatedEnergyKwh: allocatedPowerW !== null ? (allocatedPowerW * 0.25) / 1000 : null,
		gridPowerW: allocatedPowerW ?? 0,
		pvPowerW: 0,
		mandatory: false,
		priorityRank: 1,
		deadlineIso: DEADLINE,
		estimatedCostCt: allocatedPowerW !== null && allocatedPowerW > 0 ? 12 : null,
		reasonDe: "test",
		...over,
	};
}

function evaluate(
	entries: DailyAllocationEntry[],
	tel: WallboxTelemetryInput = telemetry(),
	meta = {
		status: "ready",
		date: "2026-07-11",
		revision: 1,
		validUntil: null as string | null,
		timezone: TZ,
	},
) {
	return evaluateWallboxDailyPlan({
		now: NOW,
		timezone: TZ,
		meta,
		entries,
		telemetry: tel,
		governanceEnabled: true,
		addonEnabled: true,
		vehicleCapacityKwh: 60,
	});
}

function emptySnap(): EvccTelemetrySnapshot {
	return emptyEvccTelemetrySnapshot(NOW.toISOString());
}

describe("wallbox connected gate", () => {
	it("disconnected with soc 0 is safe", () => {
		const d = evaluate([allocationEntry(3600)], telemetry({ connected: false, vehicleSocPct: 0 }));
		assert.equal(d.decisionSource, "vehicle_disconnected");
		assert.equal(d.chargingAllowedByPlan, false);
		assert.equal(d.planValid, false);
		assert.equal(d.planExecutionStatus, "vehicle_disconnected");
		assert.match(d.reasonDe, /nicht verbunden/);
	});

	it("disconnected ignores positive allocation", () => {
		const d = evaluate([allocationEntry(7200)], telemetry({ connected: false }));
		assert.equal(d.chargingAllowedByPlan, false);
		assert.equal(d.allocatedPowerW, null);
	});

	it("disconnected with deadline does not warn", () => {
		const d = evaluate([allocationEntry(3600)], telemetry({ connected: false, effectivePlanTime: DEADLINE }));
		assert.equal(d.deadlineReachable, null);
		assert.equal(d.decisionSource, "vehicle_disconnected");
	});

	it("connected allows plan evaluation", () => {
		const d = evaluate([allocationEntry(3600)]);
		assert.equal(d.connected, true);
		assert.equal(d.useDailyPlan, true);
		assert.equal(d.chargingAllowedByPlan, true);
	});

	it("unknown connected blocks allowance", () => {
		const d = evaluate([allocationEntry(3600)], telemetry({ connected: null }));
		assert.equal(d.decisionSource, "missing_telemetry");
		assert.equal(d.chargingAllowedByPlan, false);
	});
});

describe("wallbox daily plan reader", () => {
	beforeEach(() => resetWallboxDailyPlanCache());

	it("parses valid allocation JSON", () => {
		const parsed = parseDailyAllocationEntries(JSON.stringify([allocationEntry(3600)]));
		assert.ok(parsed);
		assert.equal(parsed!.length, 1);
	});

	it("rejects invalid JSON", () => {
		assert.equal(parseDailyAllocationEntries("{bad"), null);
	});

	it("rejects wrong contribution id via evaluation", () => {
		const wrong = allocationEntry(3600);
		wrong.contributionId = "battery.storage";
		const d = evaluate([wrong]);
		assert.equal(d.dailyPlanStatus, "daily_plan_zero_allocation");
		assert.equal(d.chargingAllowedByPlan, false);
	});

	it("detects duplicate allocation in slot", () => {
		const d = evaluate([allocationEntry(3600), allocationEntry(1800)]);
		assert.equal(d.decisionSource, "invalid_plan");
		assert.match(d.reasonDe, /Doppelte/);
	});

	it("rejects wrong date", () => {
		const d = evaluate([allocationEntry(3600)], telemetry(), {
			status: "ready",
			date: "2026-07-10",
			revision: 1,
			validUntil: null,
			timezone: TZ,
		});
		assert.equal(d.dailyPlanStatus, "daily_plan_wrong_date");
		assert.equal(d.useDailyPlan, false);
	});

	it("rejects expired plan", () => {
		const d = evaluate([allocationEntry(3600)], telemetry(), {
			status: "ready",
			date: "2026-07-11",
			revision: 1,
			validUntil: "2026-07-11T09:00:00.000Z",
			timezone: TZ,
		});
		assert.equal(d.dailyPlanStatus, "daily_plan_expired");
	});

	it("accepts degraded plan status", () => {
		const d = evaluate([allocationEntry(3600)], telemetry(), {
			status: "degraded",
			date: "2026-07-11",
			revision: 1,
			validUntil: null,
			timezone: TZ,
		});
		assert.equal(d.planValid, true);
	});

	it("valid zero allocation without fallback order", () => {
		const d = evaluate([]);
		assert.equal(d.useDailyPlan, true);
		assert.equal(d.decisionSource, "daily_plan_zero");
		assert.equal(d.chargingAllowedByPlan, false);
	});

	it("unallocated status is not active", () => {
		const d = evaluate([allocationEntry(3600, "unallocated")]);
		assert.equal(d.chargingAllowedByPlan, false);
		assert.equal(d.decisionSource, "daily_plan_zero");
	});

	it("rejects null and negative power", () => {
		assert.equal(evaluate([allocationEntry(null)]).chargingAllowedByPlan, false);
		assert.equal(evaluate([allocationEntry(-100)]).chargingAllowedByPlan, false);
	});

	it("uses addon allocation plan via resolveWallboxDailyPlanDecision", async () => {
		const host = {
			config: { timezone: TZ },
			async getStateAsync(id: string) {
				const map: Record<string, unknown> = {
					"planner.intent.daily_plan.status": "ready",
					"planner.intent.daily_plan.date": "2026-07-11",
					"planner.intent.daily_plan.revision": 5,
					"planner.intent.daily_plan.valid_until": "",
					"planner.intent.allocation.wallbox.plan_json": JSON.stringify([allocationEntry(3600)]),
				};
				if (!(id in map)) return null;
				return { val: map[id], ack: true } as ioBroker.State;
			},
		};
		const snap = emptySnap();
		snap.connected = { status: "valid", value: true, raw: true };
		snap.charging = { status: "valid", value: false, raw: false };
		snap.active_phases = { status: "valid", value: 1, raw: 1 };
		snap.min_current_a = { status: "valid", value: 6, raw: 6 };
		snap.max_current_a = { status: "valid", value: 16, raw: 16 };
		snap.effective_plan_time = { status: "valid", value: DEADLINE, raw: DEADLINE };
		const cfg: WallboxEvccTelemetryConfig = {
			...emptyWallboxEvccTelemetryConfig(),
			enabledStateId: "evcc.0.enabled",
			connectedStateId: "evcc.0.connected",
		};
		const d = await resolveWallboxDailyPlanDecision(host, snap, cfg, NOW, {
			governanceEnabled: true,
			addonEnabled: true,
			vehicleCapacityKwh: 60,
		});
		assert.equal(d.chargingAllowedByPlan, true);
		assert.equal(d.allocatedPowerW, 3600);
	});
});

describe("wallbox power limits", () => {
	it("computes min charge power from phases and current", () => {
		assert.equal(wallboxMinChargePowerW(1, 6), 1380);
		assert.equal(wallboxMinChargePowerW(3, 6), 4140);
	});

	it("allows allocation at exact minimum", () => {
		const minW = wallboxMinChargePowerW(1, 6)!;
		const d = evaluate([allocationEntry(minW)], telemetry({ activePhases: 1, maxCurrentA: 16 }));
		assert.equal(d.chargingAllowedByPlan, true);
	});

	it("blocks allocation below minimum", () => {
		const d = evaluate([allocationEntry(1000)], telemetry({ activePhases: 1, minCurrentA: 6, maxCurrentA: 16 }));
		assert.equal(d.dailyPlanStatus, "allocation_below_min_power");
		assert.equal(d.chargingAllowedByPlan, false);
	});

	it("caps allocation above max power", () => {
		const d = evaluate([allocationEntry(11000)], telemetry({ activePhases: 1, maxCurrentA: 16 }));
		assert.equal(d.allocatedPowerW, 3680);
		assert.equal(d.chargingAllowedByPlan, true);
	});

	it("single phase limit — no 3-phase assumption", () => {
		const limits = resolveWallboxPowerLimits(telemetry({ activePhases: 1, configuredPhases: 3, maxCurrentA: 16 }));
		assert.equal(limits.maxChargePowerW, 3680);
	});

	it("missing phase data marks degraded", () => {
		const limits = resolveWallboxPowerLimits(telemetry({ activePhases: null, configuredPhases: null, maxCurrentA: null }));
		assert.equal(limits.degraded, true);
		const d = evaluate([allocationEntry(3600)], telemetry({ activePhases: null, maxCurrentA: null }));
		assert.equal(d.dailyPlanStatus, "power_limits_unknown");
		assert.equal(d.chargingAllowedByPlan, false);
	});
});

describe("wallbox energy and deadline", () => {
	it("remaining energy from soc and capacity", () => {
		const rem = computeRemainingEnergyKwh(telemetry({ vehicleSocPct: 40, planSocPct: 80 }), 60);
		assert.equal(rem, 24);
	});

	it("ignores inactive planSoc 0 for remaining energy", () => {
		assert.equal(
			computeRemainingEnergyKwh(
				telemetry({ vehicleSocPct: 40, planSocPct: 0, planActive: false }),
				60,
			),
			null,
		);
	});

	it("uses effectiveLimitSoc when plan inactive", () => {
		assert.equal(
			computeRemainingEnergyKwh(
				telemetry({
					vehicleSocPct: 40,
					planSocPct: 0,
					planActive: false,
					effectiveLimitSocPct: 80,
				}),
				50,
			),
			20,
		);
	});

	it("unknown capacity yields null remaining", () => {
		assert.equal(computeRemainingEnergyKwh(telemetry({ vehicleSocPct: 40, planSocPct: 80 }), null), null);
	});

	it("summarizes planned energy until deadline", () => {
		const futureSlot = isoFromMs(Date.parse(SLOT_START) + DAILY_PLAN_SLOT_MS);
		const futureEnd = isoFromMs(Date.parse(futureSlot) + DAILY_PLAN_SLOT_MS);
		const entries = [
			allocationEntry(3600, "allocated", {
				slot: { startIso: futureSlot, endIso: futureEnd },
				energySource: "pv_surplus",
				pvPowerW: 3600,
				gridPowerW: 0,
			}),
		];
		const summary = summarizeWallboxPlanUntilDeadline(entries, DEADLINE, NOW.getTime());
		assert.ok(summary.plannedEnergyUntilDeadlineKwh > 0);
		assert.ok(summary.plannedPvEnergyUntilDeadlineKwh > 0);
		assert.equal(summary.activePlannedSlots, 1);
	});

	it("deadline reachable when planned energy sufficient", () => {
		const d = evaluate([allocationEntry(3600)], telemetry({ vehicleSocPct: 70, planSocPct: 80 }));
		assert.equal(typeof d.deadlineReachable, "boolean");
	});

	it("missing price yields null cost", () => {
		const d = evaluate([allocationEntry(3600, "allocated", { estimatedCostCt: null })]);
		assert.equal(d.estimatedCostCt, null);
	});
});

describe("wallbox governance and mapping", () => {
	it("governance disabled blocks plan allowance", () => {
		const d = evaluateWallboxDailyPlan({
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
			entries: [allocationEntry(3600)],
			telemetry: telemetry(),
			governanceEnabled: false,
			addonEnabled: true,
		});
		assert.equal(d.decisionSource, "governance_disabled");
		assert.equal(d.chargingAllowedByPlan, false);
	});

	it("addon disabled", () => {
		const d = evaluateWallboxDailyPlan({
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
			entries: [allocationEntry(3600)],
			telemetry: telemetry(),
			governanceEnabled: true,
			addonEnabled: false,
		});
		assert.equal(d.decisionSource, "addon_disabled");
	});

	it("mapping incomplete", () => {
		const d = evaluate([allocationEntry(3600)], telemetry({ mappingsReady: false }));
		assert.equal(d.decisionSource, "mapping_incomplete");
	});
});

describe("wallbox plan execution status", () => {
	it("in plan when charging with allocation", () => {
		const d = evaluate([allocationEntry(3600)], telemetry({ charging: true }));
		assert.equal(d.planExecutionStatus, "in_plan");
	});

	it("charging without plan", () => {
		const d = evaluate([], telemetry({ charging: true }));
		assert.equal(d.planExecutionStatus, "charging_without_plan");
	});

	it("planned but not charging", () => {
		const d = evaluate([allocationEntry(3600)], telemetry({ charging: false }));
		assert.equal(d.planExecutionStatus, "planned_but_not_charging");
	});

	it("not planned not charging", () => {
		const d = evaluate([], telemetry({ charging: false }));
		assert.equal(d.planExecutionStatus, "not_planned_not_charging");
	});

	it("charging below plan when power is lower than allocation", () => {
		const d = evaluate(
			[allocationEntry(3600)],
			telemetry({ charging: true, chargePowerW: 2000 }),
		);
		assert.equal(d.planExecutionStatus, "charging_below_plan");
	});

	it("charging above plan when power exceeds allocation", () => {
		const d = evaluate(
			[allocationEntry(3600)],
			telemetry({ charging: true, chargePowerW: 4500 }),
		);
		assert.equal(d.planExecutionStatus, "charging_above_plan");
	});

	it("in plan within tolerance", () => {
		const d = evaluate(
			[allocationEntry(3600)],
			telemetry({ charging: true, chargePowerW: 3700 }),
		);
		assert.equal(d.planExecutionStatus, "in_plan");
	});
});

describe("wallbox read-only guarantee", () => {
	it("decision always reports read-only flags", () => {
		const d = evaluate([allocationEntry(3600)]);
		assert.equal(d.runtimeControlAvailable, false);
		assert.equal(d.writeAllowed, false);
	});

	it("external plan only when no valid daily plan", () => {
		const d = evaluate([], telemetry({ planActive: true }), {
			status: "not_initialized",
			date: "2026-07-11",
			revision: 0,
			validUntil: null,
			timezone: TZ,
		});
		assert.equal(d.decisionSource, "external_plan_only");
		assert.equal(d.externalPlanActive, true);
	});
});

describe("wallbox plan cache lifecycle", () => {
	beforeEach(() => resetWallboxDailyPlanCache());

	it("parse error invalidates cache", async () => {
		const host = {
			config: { timezone: TZ },
			async getStateAsync(id: string) {
				if (id === "planner.intent.allocation.wallbox.plan_json") {
					return { val: "{invalid", ack: true } as ioBroker.State;
				}
				const base: Record<string, unknown> = {
					"planner.intent.daily_plan.status": "ready",
					"planner.intent.daily_plan.date": "2026-07-11",
					"planner.intent.daily_plan.revision": 1,
					"planner.intent.daily_plan.valid_until": "",
				};
				return { val: base[id] ?? "", ack: true } as ioBroker.State;
			},
		};
		const snap = emptySnap();
		snap.connected = { status: "valid", value: true, raw: true };
		const cfg = { enabledStateId: "x", connectedStateId: "y" } as WallboxEvccTelemetryConfig;
		const d = await resolveWallboxDailyPlanDecision(host, snap, cfg, NOW, {
			governanceEnabled: true,
			addonEnabled: true,
		});
		assert.equal(d.decisionSource, "invalid_plan");
	});

	it("resetWallboxDailyPlanCache clears state", () => {
		resetWallboxDailyPlanCache();
		assert.doesNotThrow(() => resetWallboxDailyPlanCache());
	});
});
