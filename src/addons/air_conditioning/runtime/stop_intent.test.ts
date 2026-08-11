/**
 * Climate stale STOP-retry — T1–T8 + E2E (Realfall 11.08.2026).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AcCoolingPermissionResult } from "./daily_plan";
import type { AcUnitDailyPlanResolution } from "./daily_plan";
import type { AcUnitFsmResult } from "./fsm";
import { emptyUnitPersist } from "./persist";
import {
	advanceCoolingDesired,
	clearStopIntentAfterStart,
	decideStopWrite,
	plannerCoolingBudgetOn,
	resolveCoolingDesired,
} from "./stop_intent";
import { AC_STOP_RETRY_MS } from "../constants";

function perm(overrides: Partial<AcCoolingPermissionResult> = {}): AcCoolingPermissionResult {
	return {
		decisionSource: "daily_plan",
		reasonDe: "test",
		allowStart: false,
		allowStop: false,
		allowCleaningWrites: true,
		deviceWritesAllowed: true,
		...overrides,
	};
}

function fsm(overrides: Partial<AcUnitFsmResult> = {}): AcUnitFsmResult {
	return {
		state: "running",
		demandStart: false,
		demandStop: false,
		modePurpose: "cooling",
		reasonDe: "Läuft.",
		...overrides,
	};
}

function plan(allocatedPowerW: number | null, useDailyPlan = true): AcUnitDailyPlanResolution {
	return {
		unitIndex: 1,
		contributionId: "air_conditioning.unit_1",
		dailyPlanStatus: allocatedPowerW != null && allocatedPowerW > 0 ? "daily_plan_valid" : "daily_plan_zero_allocation",
		dailyPlanRevision: 1,
		slotStartIso: "2026-08-11T09:00:00.000Z",
		slotEndIso: "2026-08-11T09:15:00.000Z",
		allocatedPowerW,
		expectedPowerW: 850,
		powerModelSource: "config",
		allocationStatus: "allocated",
		allocationReasonDe: "test",
		useDailyPlan,
		powerModelValid: true,
		allocationAllowsStart: (allocatedPowerW ?? 0) > 0,
	};
}

describe("climate stop intent — T1 current OFF retry allowed", () => {
	it("T1: pending stop under lasting OFF → execute retry", () => {
		const up = emptyUnitPersist(1);
		advanceCoolingDesired(up, "off");
		const first = decideStopWrite({
			up,
			desired: "off",
			feedbackOn: true,
			stopRetryReady: true,
			lastStopAtMs: null,
			nowMs: 1_000,
		});
		assert.equal(first.action, "execute_stop");
		up.lastStopAtMs = 1_000;
		up.stopArmedGeneration = up.commandGeneration;

		const retry = decideStopWrite({
			up,
			desired: "off",
			feedbackOn: true,
			stopRetryReady: true,
			lastStopAtMs: up.lastStopAtMs,
			nowMs: 1_000 + AC_STOP_RETRY_MS + 1,
		});
		assert.equal(retry.action, "execute_stop");
		assert.equal(retry.action === "execute_stop" && retry.isRetry, true);
	});
});

describe("climate stop intent — T2 OFF→ON cancels retry", () => {
	it("T2: stop armed under OFF, then ON → cancel, no execute", () => {
		const up = emptyUnitPersist(1);
		advanceCoolingDesired(up, "off");
		decideStopWrite({
			up,
			desired: "off",
			feedbackOn: true,
			stopRetryReady: false,
			lastStopAtMs: null,
			nowMs: 1_000,
		});
		assert.ok(up.stopArmedGeneration != null);

		const cleared = advanceCoolingDesired(up, "on");
		assert.equal(cleared.stopCleared, true);
		assert.equal(up.stopArmedGeneration, null);

		const d = decideStopWrite({
			up,
			desired: "on",
			feedbackOn: true,
			stopRetryReady: true,
			lastStopAtMs: 500,
			nowMs: 2_000,
		});
		assert.equal(d.action, "none");
	});
});

describe("climate stop intent — T3 start then feedback ON", () => {
	it("T3: successful START clears stale stop; hold under planner ON → no OFF write", () => {
		const up = emptyUnitPersist(1);
		advanceCoolingDesired(up, "off");
		up.stopArmedGeneration = up.commandGeneration;
		up.lastStopAtMs = 100;
		up.lastStartAtMs = 200;
		clearStopIntentAfterStart(up);
		assert.equal(up.stopArmedGeneration, null);
		assert.equal(up.lastStopAtMs, null);

		const desired = resolveCoolingDesired({
			permission: perm({ allowStop: false, allowStart: false }),
			fsm: fsm({ demandStop: false }),
			dailyPlan: plan(850),
			feedbackOn: true,
		});
		assert.equal(desired, "hold");
		advanceCoolingDesired(up, desired);
		const d = decideStopWrite({
			up,
			desired,
			feedbackOn: true,
			stopRetryReady: true,
			lastStopAtMs: up.lastStopAtMs,
			nowMs: 300,
		});
		assert.notEqual(d.action, "execute_stop");
	});
});

describe("climate stop intent — T4 revision/generation", () => {
	it("T4: stop from rev A must not execute under later ON generations", () => {
		const up = emptyUnitPersist(1);
		advanceCoolingDesired(up, "off"); // gen 1
		const armGen = up.commandGeneration;
		up.stopArmedGeneration = armGen;

		advanceCoolingDesired(up, "on"); // gen 2 — clears
		advanceCoolingDesired(up, "hold"); // gen 3
		assert.equal(up.stopArmedGeneration, null);

		/** Simulate leaked stale arm from gen 1 */
		up.stopArmedGeneration = armGen;
		const d = decideStopWrite({
			up,
			desired: "off",
			feedbackOn: true,
			stopRetryReady: true,
			lastStopAtMs: 1,
			nowMs: 9_000,
		});
		/** desired off re-arms under CURRENT gen — stale gen cancelled first */
		assert.ok(d.action === "cancel_stale" || d.action === "execute_stop");
		if (d.action === "cancel_stale") {
			assert.match(d.reasonDe, /superseded|ON/i);
		}
		/** After cancel, a fresh OFF arm under current gen may execute: */
		const d2 = decideStopWrite({
			up,
			desired: "off",
			feedbackOn: true,
			stopRetryReady: true,
			lastStopAtMs: 1,
			nowMs: 9_001,
		});
		assert.equal(d2.action, "execute_stop");
		assert.equal(up.stopArmedGeneration, up.commandGeneration);
		assert.notEqual(up.stopArmedGeneration, armGen);
	});
});

describe("climate stop intent — T5 real new OFF still works", () => {
	it("T5: after ON/HOLD, new OFF executes stop", () => {
		const up = emptyUnitPersist(1);
		advanceCoolingDesired(up, "hold");
		clearStopIntentAfterStart(up);
		advanceCoolingDesired(up, "off");
		const d = decideStopWrite({
			up,
			desired: "off",
			feedbackOn: true,
			stopRetryReady: true,
			lastStopAtMs: null,
			nowMs: 5_000,
		});
		assert.equal(d.action, "execute_stop");
		assert.equal(d.action === "execute_stop" && d.isRetry, false);
	});
});

describe("climate stop intent — T6 late feedback", () => {
	it("T6: old OFF intent + interim ON + late feedback → no stale STOP", () => {
		const up = emptyUnitPersist(1);
		advanceCoolingDesired(up, "off");
		up.stopArmedGeneration = up.commandGeneration;
		up.lastStopAtMs = 1_000;

		advanceCoolingDesired(up, "on");
		clearStopIntentAfterStart(up);
		up.lastStartAtMs = 2_000;

		const desired = resolveCoolingDesired({
			permission: perm({ allowStop: false }),
			fsm: fsm(),
			dailyPlan: plan(850),
			feedbackOn: true,
		});
		assert.equal(desired, "hold");
		advanceCoolingDesired(up, desired);
		const d = decideStopWrite({
			up,
			desired,
			feedbackOn: true,
			stopRetryReady: true,
			lastStopAtMs: up.lastStopAtMs,
			nowMs: 3_000,
		});
		assert.notEqual(d.action, "execute_stop");
	});
});

describe("climate stop intent — T7 units independent", () => {
	it("T7: unit1 stop campaign does not affect unit2", () => {
		const u1 = emptyUnitPersist(1);
		const u2 = emptyUnitPersist(2);
		advanceCoolingDesired(u1, "off");
		u1.stopArmedGeneration = u1.commandGeneration;
		advanceCoolingDesired(u2, "hold");
		assert.ok(u1.stopArmedGeneration != null);
		assert.equal(u2.stopArmedGeneration, null);
		const d2 = decideStopWrite({
			up: u2,
			desired: "hold",
			feedbackOn: true,
			stopRetryReady: true,
			lastStopAtMs: null,
			nowMs: 1,
		});
		assert.notEqual(d2.action, "execute_stop");
	});
});

describe("climate stop intent — T8 realfall 11.08.2026", () => {
	it("T8: 13min-old stop + new ON start + feedback ON + retry timer → no OFF", () => {
		const up = emptyUnitPersist(1);
		const t0 = Date.parse("2026-08-11T08:47:00.000Z");
		const tStart = Date.parse("2026-08-11T09:00:10.000Z");
		const tRetry = Date.parse("2026-08-11T09:01:16.000Z");

		advanceCoolingDesired(up, "off");
		up.lastStopAtMs = t0;
		up.stopArmedGeneration = up.commandGeneration;

		/** Neuer Planner-Slot ON → START */
		advanceCoolingDesired(up, "on");
		up.lastStartAtMs = tStart;
		clearStopIntentAfterStart(up);
		assert.equal(up.lastStopAtMs, null);
		assert.equal(up.stopArmedGeneration, null);

		const desired = resolveCoolingDesired({
			permission: perm({
				allowStart: false,
				allowStop: false,
				decisionSource: "daily_plan",
			}),
			fsm: fsm({
				demandStart: false,
				demandStop: false,
				reasonDe: "Läuft (Temp 26.0 °C ≥ 24.5 °C — cool).",
			}),
			dailyPlan: plan(850),
			feedbackOn: true,
		});
		assert.equal(desired, "hold");
		assert.equal(plannerCoolingBudgetOn(plan(850)), true);
		advanceCoolingDesired(up, desired);

		assert.ok(tRetry - t0 > 800_000, "simulates ~13 min since last stop attempt");
		const d = decideStopWrite({
			up,
			desired,
			feedbackOn: true,
			stopRetryReady: true,
			lastStopAtMs: up.lastStopAtMs,
			nowMs: tRetry,
		});
		assert.notEqual(d.action, "execute_stop");
		assert.ok(d.action === "none" || d.action === "cancel_stale");
	});
});

describe("climate stop intent — E2E reconcile chain", () => {
	it("E2E: OFF arm → ON start → hold → retry window → no stale STOP", () => {
		const up = emptyUnitPersist(2);
		const writes: string[] = [];

		const run = (desiredLabel: "off" | "on" | "hold", feedbackOn: boolean, nowMs: number) => {
			const dailyPlan = plan(desiredLabel === "off" ? 0 : 850);
			const permission = perm({
				allowStop: desiredLabel === "off",
				allowStart: desiredLabel === "on" && !feedbackOn,
			});
			const desired = resolveCoolingDesired({
				permission,
				fsm: fsm({
					demandStop: desiredLabel === "off" && feedbackOn ? false : false,
					demandStart: desiredLabel === "on" && !feedbackOn,
				}),
				dailyPlan,
				feedbackOn,
			});
			/** Force desired for E2E script (permission already set). */
			const forced =
				desiredLabel === "off" ? "off" : desiredLabel === "on" ? (feedbackOn ? "hold" : "on") : "hold";
			advanceCoolingDesired(up, forced);
			if (forced === "on" && !feedbackOn) {
				up.lastStartAtMs = nowMs;
				clearStopIntentAfterStart(up);
				writes.push("start");
			}
			const d = decideStopWrite({
				up,
				desired: forced,
				feedbackOn,
				stopRetryReady: !up.lastStopAtMs || nowMs - (up.lastStopAtMs ?? 0) >= AC_STOP_RETRY_MS,
				lastStopAtMs: up.lastStopAtMs,
				nowMs,
			});
			if (d.action === "execute_stop") {
				writes.push("stop");
				up.lastStopAtMs = nowMs;
			} else if (d.action === "cancel_stale") {
				writes.push("cancel");
			}
			void desired;
		};

		run("off", true, 1_000);
		run("off", true, 1_000); // arm / first stop
		assert.ok(writes.includes("stop"));

		run("on", false, 2_000);
		assert.ok(writes.includes("start"));
		run("hold", true, 2_500);
		run("hold", true, 2_500 + AC_STOP_RETRY_MS + 5_000);

		assert.equal(writes.filter((w) => w === "stop").length, 1, "no second stale stop after ON");
		assert.ok(!writes.slice(writes.indexOf("start")).includes("stop"));
	});
});
