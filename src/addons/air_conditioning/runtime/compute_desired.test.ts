/**
 * Eine Desired-Authority — Plan + Demand in computeAcCoolingDesired.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AcUnitDailyPlanResolution } from "./daily_plan";
import type { AcUnitFsmResult } from "./fsm";
import {
	computeAcCoolingDesired,
	isExplicitPlannerOff,
	isSlotBudgetMissing,
} from "./compute_desired";

function fsm(over: Partial<AcUnitFsmResult> = {}): AcUnitFsmResult {
	return {
		state: "idle",
		demandStart: false,
		demandStop: false,
		modePurpose: "cooling",
		reasonDe: "test",
		...over,
	};
}

function plan(over: Partial<AcUnitDailyPlanResolution> = {}): AcUnitDailyPlanResolution {
	return {
		unitIndex: 1,
		contributionId: "air_conditioning.unit_1",
		dailyPlanStatus: "daily_plan_valid",
		dailyPlanRevision: 1,
		slotStartIso: "2026-08-11T09:30:00.000Z",
		slotEndIso: "2026-08-11T09:45:00.000Z",
		allocatedPowerW: 850,
		expectedPowerW: 850,
		powerModelSource: "config",
		allocationStatus: "allocated",
		allocationReasonDe: "test",
		useDailyPlan: true,
		powerModelValid: true,
		allocationAllowsStart: true,
		...over,
	};
}

const base = {
	unitEnabled: true,
	governanceEnabled: true,
	addonEnabled: true,
	cleaningActive: false,
	startRetryReady: true,
};

describe("computeAcCoolingDesired — single authority", () => {
	it("T1: planner ON + demand start + fb off → desired on", () => {
		const d = computeAcCoolingDesired({
			...base,
			fsm: fsm({ demandStart: true, reasonDe: "Temp hoch — Einschalten." }),
			dailyPlan: plan(),
			feedbackOn: false,
		});
		assert.equal(d.desired, "on");
		assert.equal(d.allowStart, true);
		assert.equal(d.allowStop, false);
		assert.equal(d.plannerOff, false);
	});

	it("T2/T3/T13/T14: planner ON + fb on + no demandStop → hold, never stop", () => {
		const d = computeAcCoolingDesired({
			...base,
			fsm: fsm({ state: "running", demandStart: false, demandStop: false }),
			dailyPlan: plan({ allocatedPowerW: 850 }),
			feedbackOn: true,
		});
		assert.equal(d.desired, "hold");
		assert.equal(d.allowStop, false);
		assert.equal(d.allowStart, false);
	});

	it("T4: same allocation new revision → still hold when fb on", () => {
		const d = computeAcCoolingDesired({
			...base,
			fsm: fsm({ state: "running" }),
			dailyPlan: plan({ dailyPlanRevision: 99, allocatedPowerW: 850 }),
			feedbackOn: true,
		});
		assert.equal(d.desired, "hold");
		assert.equal(d.allowStop, false);
	});

	it("T5: explicit replan 0 W → off when fb on", () => {
		const p = plan({
			allocatedPowerW: 0,
			allocationStatus: "allocated",
			dailyPlanStatus: "daily_plan_zero_allocation",
			allocationAllowsStart: false,
		});
		assert.equal(isExplicitPlannerOff(p), true);
		const d = computeAcCoolingDesired({
			...base,
			fsm: fsm({ state: "running", demandStop: false }),
			dailyPlan: p,
			feedbackOn: true,
		});
		assert.equal(d.desired, "off");
		assert.equal(d.allowStop, true);
		assert.equal(d.plannerOff, true);
	});

	it("runtimeHold empty NOW (status none) is NOT plannerOff — hold while running", () => {
		const p = plan({
			allocatedPowerW: 0,
			allocationStatus: "none",
			dailyPlanStatus: "daily_plan_zero_allocation",
			allocationAllowsStart: false,
		});
		assert.equal(isExplicitPlannerOff(p), false);
		assert.equal(isSlotBudgetMissing(p), true);
		const d = computeAcCoolingDesired({
			...base,
			fsm: fsm({ state: "running", demandStop: false }),
			dailyPlan: p,
			feedbackOn: true,
		});
		assert.equal(d.desired, "hold");
		assert.equal(d.allowStop, false);
		assert.equal(d.plannerOff, false);
	});

	it("T7: demand fulfilled (demandStop) → off even with planner budget", () => {
		const d = computeAcCoolingDesired({
			...base,
			fsm: fsm({ state: "running", demandStop: true, reasonDe: "Temp niedrig — Abschalten." }),
			dailyPlan: plan(),
			feedbackOn: true,
		});
		assert.equal(d.desired, "off");
		assert.equal(d.allowStop, true);
		assert.equal(d.plannerOff, false);
	});

	it("T8: explicit planner OFF → stop", () => {
		const d = computeAcCoolingDesired({
			...base,
			fsm: fsm({ state: "running" }),
			dailyPlan: plan({
				allocatedPowerW: 0,
				allocationStatus: "allocated",
				allocationAllowsStart: false,
			}),
			feedbackOn: true,
		});
		assert.equal(d.desired, "off");
		assert.equal(d.allowStop, true);
	});

	it("T9: planner OFF + fb already off → idle, no stop write intent", () => {
		const d = computeAcCoolingDesired({
			...base,
			fsm: fsm({ state: "idle" }),
			dailyPlan: plan({
				allocatedPowerW: 0,
				allocationStatus: "allocated",
				allocationAllowsStart: false,
			}),
			feedbackOn: false,
		});
		assert.equal(d.desired, "idle");
		assert.equal(d.allowStop, false);
	});

	it("T10: rate-limit blocks start, does not create stop", () => {
		const d = computeAcCoolingDesired({
			...base,
			startRetryReady: false,
			fsm: fsm({ demandStart: true }),
			dailyPlan: plan(),
			feedbackOn: false,
		});
		assert.equal(d.desired, "idle");
		assert.equal(d.allowStart, false);
		assert.equal(d.allowStop, false);
		assert.equal(d.decisionSource, "rate_limited");
	});

	it("T11: cleaning → no cool start/stop authority", () => {
		const d = computeAcCoolingDesired({
			...base,
			cleaningActive: true,
			fsm: fsm({ state: "running", demandStop: true }),
			dailyPlan: plan(),
			feedbackOn: true,
		});
		assert.equal(d.allowStart, false);
		assert.equal(d.allowStop, false);
		assert.equal(d.decisionSource, "cleaning");
	});

	describe("Klima-/Ownership-Block: Hard-Off-Restzeit vs. Komfortbedarf", () => {
		it("19:15 bei Hard-Off 20:00 (45 Min Restzeit), geringer Komfortbedarf → kein unsinniger Neustart", () => {
			const d = computeAcCoolingDesired({
				...base,
				fsm: fsm({ demandStart: true, demandUrgency01: 0.1, reasonDe: "Temp knapp über Schwelle." }),
				dailyPlan: plan(),
				feedbackOn: false,
				remainingMinutesUntilHardOff: 45,
				minWorthwhileRuntimeMin: 60,
			});
			assert.equal(d.allowStart, false);
			assert.equal(d.desired, "idle");
			assert.equal(d.decisionSource, "hard_off_not_worthwhile");
			assert.match(d.reasonDe, /Hard-Off in 45 Min/);
		});

		it("gleicher Zeitpunkt, hoher Komfortbedarf → Start weiterhin möglich", () => {
			const d = computeAcCoolingDesired({
				...base,
				fsm: fsm({ demandStart: true, demandUrgency01: 0.95, reasonDe: "Temp deutlich über Schwelle." }),
				dailyPlan: plan(),
				feedbackOn: false,
				remainingMinutesUntilHardOff: 45,
				minWorthwhileRuntimeMin: 60,
			});
			assert.equal(d.allowStart, true);
			assert.equal(d.desired, "on");
		});

		it("ohne konfigurierten Hard-Off bleibt der Start unbeeinflusst", () => {
			const d = computeAcCoolingDesired({
				...base,
				fsm: fsm({ demandStart: true, demandUrgency01: 0, reasonDe: "Temp hoch." }),
				dailyPlan: plan(),
				feedbackOn: false,
				remainingMinutesUntilHardOff: null,
			});
			assert.equal(d.allowStart, true);
		});
	});

	describe("Klima-/Ownership-Block: Manual Override", () => {
		it("manuelles Einschalten Klima → EMS schaltet nicht sofort wieder aus", () => {
			const d = computeAcCoolingDesired({
				...base,
				fsm: fsm({ state: "running", demandStop: false }),
				dailyPlan: plan({ allocatedPowerW: 0, allocationStatus: "allocated" }), // Planner-OFF
				feedbackOn: true,
				ownershipOverrideActive: true,
				ownershipReasonDe: "Manuelles Einschalten erkannt — EMS-Steuerung pausiert bis 2026-08-28T19:45:00.000Z.",
			});
			assert.equal(d.allowStop, false);
			assert.equal(d.allowStart, false);
			assert.equal(d.desired, "hold");
			assert.equal(d.decisionSource, "manual_override");
		});

		it("manuelles Ausschalten Klima → EMS schaltet nicht sofort wieder ein", () => {
			const d = computeAcCoolingDesired({
				...base,
				fsm: fsm({ demandStart: true, reasonDe: "Temp hoch." }),
				dailyPlan: plan(),
				feedbackOn: false,
				ownershipOverrideActive: true,
				ownershipReasonDe: "Manuelles Ausschalten erkannt — EMS-Steuerung pausiert bis 2026-08-28T19:45:00.000Z.",
			});
			assert.equal(d.allowStart, false);
			assert.equal(d.desired, "idle");
			assert.equal(d.decisionSource, "manual_override");
		});

		it("Override endet automatisch — normale Planner-/Demand-Logik greift danach wieder", () => {
			const d = computeAcCoolingDesired({
				...base,
				fsm: fsm({ demandStart: true, reasonDe: "Temp hoch." }),
				dailyPlan: plan(),
				feedbackOn: false,
				ownershipOverrideActive: false,
			});
			assert.equal(d.allowStart, true);
			assert.equal(d.decisionSource, "daily_plan");
		});
	});
});
