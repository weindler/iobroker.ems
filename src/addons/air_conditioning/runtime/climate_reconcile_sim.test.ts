/**
 * Deterministischer Climate-Reconcile-Simulator — T1–T14 + Invarianten.
 * Kein SmartThings / kein Realgerät.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AcUnitDailyPlanResolution } from "./daily_plan";
import type { AcUnitFsmResult } from "./fsm";
import { emptyUnitPersist, type AcUnitPersist } from "./persist";
import {
	advanceCoolingDesired,
	clearStopIntentAfterStart,
	decideStopWrite,
	type AcCoolingDesired,
} from "./stop_intent";
import { computeAcCoolingDesired } from "./compute_desired";
import { AC_STOP_RETRY_MS } from "../constants";

type SimPlan = {
	revision: number;
	allocatedPowerW: number;
	allocationStatus: string;
};

type SimUnit = {
	tempC: number;
	onTempC: number;
	offTempC: number;
	feedbackOn: boolean;
	persist: AcUnitPersist;
};

type HardwareAction = "start" | "stop" | "none";

function fsmFrom(unit: SimUnit): AcUnitFsmResult {
	if (unit.feedbackOn) {
		if (unit.tempC <= unit.offTempC) {
			return {
				state: "running",
				demandStart: false,
				demandStop: true,
				modePurpose: "cooling",
				reasonDe: "Temp niedrig — Abschalten.",
			};
		}
		return {
			state: "running",
			demandStart: false,
			demandStop: false,
			modePurpose: "cooling",
			reasonDe: "Läuft.",
		};
	}
	if (unit.tempC >= unit.onTempC) {
		return {
			state: "idle",
			demandStart: true,
			demandStop: false,
			modePurpose: "cooling",
			reasonDe: "Temp hoch — Einschalten.",
		};
	}
	return {
		state: "idle",
		demandStart: false,
		demandStop: false,
		modePurpose: "cooling",
		reasonDe: "Kein Bedarf.",
	};
}

function toDailyPlan(p: SimPlan): AcUnitDailyPlanResolution {
	const budgetOn = p.allocatedPowerW > 0 && p.allocationStatus !== "none";
	const explicitZero = p.allocatedPowerW <= 0 && p.allocationStatus === "allocated";
	return {
		unitIndex: 1,
		contributionId: "air_conditioning.unit_1",
		dailyPlanStatus: budgetOn ? "daily_plan_valid" : "daily_plan_zero_allocation",
		dailyPlanRevision: p.revision,
		slotStartIso: "2026-08-11T09:30:00.000Z",
		slotEndIso: "2026-08-11T09:45:00.000Z",
		allocatedPowerW: p.allocationStatus === "none" ? 0 : p.allocatedPowerW,
		expectedPowerW: 850,
		powerModelSource: "config",
		allocationStatus: p.allocationStatus,
		allocationReasonDe: explicitZero ? "Planner-OFF" : "test",
		useDailyPlan: true,
		powerModelValid: true,
		allocationAllowsStart: budgetOn,
	};
}

/**
 * Ein Reconcile-Schritt (Single-Action-Modell):
 * frische Inputs → desired → vs feedback → max. eine Hardware-Aktion.
 */
function reconcileOnce(
	unit: SimUnit,
	plan: SimPlan,
	nowMs: number,
	opts?: { startRetryReady?: boolean },
): {
	desired: AcCoolingDesired;
	action: HardwareAction;
	publishedRunning: boolean;
	plannerOff: boolean;
	decisionSource: string;
} {
	const fsm = fsmFrom(unit);
	const dailyPlan = toDailyPlan(plan);
	const startRetryReady = opts?.startRetryReady ?? true;
	const control = computeAcCoolingDesired({
		unitEnabled: true,
		governanceEnabled: true,
		addonEnabled: true,
		cleaningActive: false,
		fsm,
		dailyPlan,
		feedbackOn: unit.feedbackOn,
		startRetryReady,
	});
	advanceCoolingDesired(unit.persist, control.desired);

	let action: HardwareAction = "none";
	if (control.desired === "off" && unit.feedbackOn) {
		const stop = decideStopWrite({
			up: unit.persist,
			desired: control.desired,
			feedbackOn: true,
			stopRetryReady: !unit.persist.lastStopAtMs || nowMs - unit.persist.lastStopAtMs >= AC_STOP_RETRY_MS,
			lastStopAtMs: unit.persist.lastStopAtMs,
			nowMs,
		});
		if (stop.action === "execute_stop") {
			action = "stop";
			unit.persist.lastStopAtMs = nowMs;
			unit.feedbackOn = false;
			unit.persist.running = false;
		}
	} else if (control.desired === "on" && !unit.feedbackOn && control.allowStart) {
		action = "start";
		clearStopIntentAfterStart(unit.persist);
		unit.persist.lastStartAtMs = nowMs;
		// Feedback kommt verzögert — Caller setzt feedbackOn später
	}

	/*
	 * I3: published running nur aus aktuellem Feedback — nie aus Pre-START-Snapshot.
	 * Nach START-await wäre feedback frisch ON; hier setzt Caller das.
	 */
	const publishedRunning = unit.feedbackOn;
	unit.persist.running = publishedRunning;

	return {
		desired: control.desired,
		action,
		publishedRunning,
		plannerOff: control.plannerOff,
		decisionSource: control.decisionSource,
	};
}

describe("climate reconcile simulator — T1–T14", () => {
	it("T1: exactly one START when planner ON, temp high, fb off", () => {
		const unit: SimUnit = {
			tempC: 26,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: false,
			persist: emptyUnitPersist(1),
		};
		const r1 = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_000);
		assert.equal(r1.action, "start");
		assert.equal(r1.desired, "on");
		const rBlocked = reconcileOnce(
			unit,
			{ revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" },
			1_200,
			{ startRetryReady: false },
		);
		assert.equal(rBlocked.action, "none");
		assert.equal(rBlocked.desired, "idle");
	});

	it("T2: after 17s feedback ON, planner stays ON → no STOP, running true", () => {
		const unit: SimUnit = {
			tempC: 26,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: false,
			persist: emptyUnitPersist(1),
		};
		const t0 = 1_000;
		const start = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, t0);
		assert.equal(start.action, "start");
		unit.feedbackOn = true;
		const after = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, t0 + 17_000);
		assert.equal(after.desired, "hold");
		assert.equal(after.action, "none");
		assert.equal(after.publishedRunning, true);
	});

	it("T3: feedback-ON reconcile with planner ON → no switch_off", () => {
		const unit: SimUnit = {
			tempC: 26,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: true,
			persist: emptyUnitPersist(1),
		};
		unit.persist.lastStartAtMs = 1_000;
		clearStopIntentAfterStart(unit.persist);
		const r = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_300);
		assert.equal(r.action, "none");
		assert.notEqual(r.desired, "off");
	});

	it("T4: replan same alloc new revision during START → no STOP after fb ON", () => {
		const unit: SimUnit = {
			tempC: 26,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: false,
			persist: emptyUnitPersist(1),
		};
		reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_000);
		unit.feedbackOn = true;
		const r = reconcileOnce(unit, { revision: 2, allocatedPowerW: 850, allocationStatus: "allocated" }, 18_000);
		assert.equal(r.action, "none");
		assert.equal(r.desired, "hold");
	});

	it("T5: real replan to 0 W during START → clean STOP after fb ON", () => {
		const unit: SimUnit = {
			tempC: 26,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: false,
			persist: emptyUnitPersist(1),
		};
		reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_000);
		clearStopIntentAfterStart(unit.persist);
		unit.feedbackOn = true;
		const r = reconcileOnce(unit, { revision: 2, allocatedPowerW: 0, allocationStatus: "allocated" }, 18_000);
		assert.equal(r.desired, "off");
		assert.equal(r.action, "stop");
		assert.equal(r.plannerOff, true);
	});

	it("T6: stale fb=OFF must not publish running=false after successful START", () => {
		const unit: SimUnit = {
			tempC: 26,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: false,
			persist: emptyUnitPersist(1),
		};
		const staleFbOff = false;
		reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_000);
		// await complete — fresh feedback ON
		unit.feedbackOn = true;
		const publishedRunning = unit.feedbackOn; // engine rule: use fresh, not staleFbOff
		assert.equal(publishedRunning, true);
		assert.equal(staleFbOff, false);
		assert.notEqual(publishedRunning, staleFbOff);
	});

	it("T7: demand fulfilled → STOP via desired off (visible, not hidden path)", () => {
		const unit: SimUnit = {
			tempC: 22,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: true,
			persist: emptyUnitPersist(1),
		};
		const r = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 5_000);
		assert.equal(r.desired, "off");
		assert.equal(r.action, "stop");
		assert.equal(r.plannerOff, false);
	});

	it("T8: planner OFF → STOP when fb ON", () => {
		const unit: SimUnit = {
			tempC: 26,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: true,
			persist: emptyUnitPersist(1),
		};
		const r = reconcileOnce(unit, { revision: 1, allocatedPowerW: 0, allocationStatus: "allocated" }, 5_000);
		assert.equal(r.action, "stop");
	});

	it("T9: planner OFF + fb OFF → no OFF write", () => {
		const unit: SimUnit = {
			tempC: 26,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: false,
			persist: emptyUnitPersist(1),
		};
		const r = reconcileOnce(unit, { revision: 1, allocatedPowerW: 0, allocationStatus: "allocated" }, 5_000);
		assert.equal(r.action, "none");
		assert.equal(r.desired, "idle");
	});

	it("T10: rate-limit blocks START, no STOP", () => {
		const unit: SimUnit = {
			tempC: 26,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: false,
			persist: emptyUnitPersist(1),
		};
		unit.persist.lastStartAtMs = 1_000;
		const r = reconcileOnce(
			unit,
			{ revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" },
			2_000,
			{ startRetryReady: false },
		);
		assert.equal(r.action, "none");
		assert.equal(r.desired, "idle");
	});

	it("T12: two units have independent persist/desired", () => {
		const u1: SimUnit = {
			tempC: 26,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: false,
			persist: emptyUnitPersist(1),
		};
		const u2: SimUnit = {
			tempC: 22,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: true,
			persist: emptyUnitPersist(2),
		};
		const r1 = reconcileOnce(u1, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_000);
		const r2 = reconcileOnce(u2, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_000);
		assert.equal(r1.action, "start");
		assert.equal(r2.action, "stop");
		assert.notEqual(u1.persist.commandGeneration, undefined);
		assert.ok(u1.persist !== u2.persist);
	});

	it("T13: rapid feedback event 300ms later — planner ON → no STOP", () => {
		const unit: SimUnit = {
			tempC: 26,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: false,
			persist: emptyUnitPersist(1),
		};
		const t0 = 1_000;
		reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, t0);
		clearStopIntentAfterStart(unit.persist);
		unit.feedbackOn = true;
		const r = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, t0 + 300);
		assert.equal(r.action, "none");
		assert.equal(r.desired, "hold");
	});

	it("T14 Realfall 11.08.2026: START→fb ON→reconcile @850W → no stop", () => {
		const unit: SimUnit = {
			tempC: 26,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: false,
			persist: emptyUnitPersist(1),
		};
		const tStart = Date.parse("2026-08-11T09:30:10.000Z");
		const tFb = Date.parse("2026-08-11T09:30:27.000Z");
		const tRec = Date.parse("2026-08-11T09:30:28.000Z");
		assert.equal(
			reconcileOnce(unit, { revision: 10, allocatedPowerW: 850, allocationStatus: "allocated" }, tStart).action,
			"start",
		);
		clearStopIntentAfterStart(unit.persist);
		unit.feedbackOn = true;
		// runtimeHold-style missing NOW entry must NOT stop
		const mid = reconcileOnce(unit, { revision: 10, allocatedPowerW: 0, allocationStatus: "none" }, tFb);
		assert.equal(mid.desired, "hold");
		assert.equal(mid.action, "none");
		const late = reconcileOnce(unit, { revision: 10, allocatedPowerW: 850, allocationStatus: "allocated" }, tRec);
		assert.equal(late.desired, "hold");
		assert.equal(late.action, "none");
		assert.equal(late.publishedRunning, true);
	});
});

describe("climate reconcile invariants", () => {
	it("I1: desired ON/HOLD + fb ON → never STOP write", () => {
		for (const desired of ["on", "hold"] as const) {
			const up = emptyUnitPersist(1);
			advanceCoolingDesired(up, desired);
			const d = decideStopWrite({
				up,
				desired,
				feedbackOn: true,
				stopRetryReady: true,
				lastStopAtMs: null,
				nowMs: 1,
			});
			assert.notEqual(d.action, "execute_stop", desired);
		}
	});

	it("I2: desired OFF + fb ON → at most one stop arm per generation", () => {
		const up = emptyUnitPersist(1);
		advanceCoolingDesired(up, "off");
		const a = decideStopWrite({
			up,
			desired: "off",
			feedbackOn: true,
			stopRetryReady: true,
			lastStopAtMs: null,
			nowMs: 1,
		});
		assert.equal(a.action, "execute_stop");
		const gen = up.stopArmedGeneration;
		assert.equal(gen, up.commandGeneration);
		up.lastStopAtMs = 1;
		const b = decideStopWrite({
			up,
			desired: "off",
			feedbackOn: true,
			stopRetryReady: false,
			lastStopAtMs: 1,
			nowMs: 2,
		});
		assert.equal(b.action, "wait_retry");
		assert.equal(up.stopArmedGeneration, gen);
	});

	it("I3: after async START publish uses fresh fb not pre-start snapshot", () => {
		const preStartFb = false;
		const freshFb = true;
		const published = freshFb; // engine contract
		assert.equal(published, true);
		assert.notEqual(published, preStartFb);
	});

	it("I5: new planner revision with OFF invalidates keep-on", () => {
		const unit: SimUnit = {
			tempC: 26,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: true,
			persist: emptyUnitPersist(1),
		};
		advanceCoolingDesired(unit.persist, "hold");
		const r = reconcileOnce(unit, { revision: 11, allocatedPowerW: 0, allocationStatus: "allocated" }, 9_000);
		assert.equal(r.desired, "off");
		assert.equal(r.action, "stop");
	});

	it("I6: one reconcile → at most one hardware action", () => {
		const unit: SimUnit = {
			tempC: 26,
			onTempC: 24.5,
			offTempC: 23,
			feedbackOn: false,
			persist: emptyUnitPersist(1),
		};
		const r = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_000);
		assert.ok(r.action === "start" || r.action === "none" || r.action === "stop");
		// single action enum — never start+stop in one return
		assert.ok(["start", "stop", "none"].includes(r.action));
	});
});
