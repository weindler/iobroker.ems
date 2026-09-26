import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	initialSonnenRuntime,
	stepSonnenFsm,
	type PlannedBatteryWrite,
	type SonnenFsmContext,
	type SonnenRuntime,
} from "./fsm.js";

const MODE = { manual: 1, selfConsumption: 2 };
const SEQ = {
	pauseBeforeManualMs: 0,
	waitAfterManualMs: 0,
	feedbackTimeoutModeMs: 30_000,
	feedbackTimeoutChargeMs: 30_000,
	maxManualModeMs: 1_000_000,
	restoreDelayMs: 0,
};
const TOL = { absoluteW: 100, relativePct: 10 };

function baseCtx(over: Partial<SonnenFsmContext>, nowMs: number): SonnenFsmContext {
	return {
		nowMs,
		intentValid: true,
		chargingActionRequested: true,
		action: "charge",
		requestId: "r1",
		effectiveChargeW: 2000,
		targetSocPct: null,
		stopReason: null,
		actualMode: MODE.manual,
		actualChargingW: 2000,
		socPct: 50,
		modeValues: MODE,
		sequence: SEQ,
		tolerance: TOL,
		gridBalanceActive: false,
		simulateFeedback: false,
		...over,
	};
}

function drive(
	rt: SonnenRuntime,
	overFor: (rt: SonnenRuntime) => Partial<SonnenFsmContext>,
	steps: number,
	startMs: number,
): { rt: SonnenRuntime; writes: PlannedBatteryWrite[]; gb: string[] } {
	let now = startMs;
	const writes: PlannedBatteryWrite[] = [];
	const gb: string[] = [];
	let cur = rt;
	for (let i = 0; i < steps; i++) {
		now += 1000;
		const step = stepSonnenFsm(cur, baseCtx(overFor(cur), now));
		cur = step.runtime;
		writes.push(...step.writes);
		if (step.gridBalance) gb.push(step.gridBalance);
	}
	return { rt: cur, writes, gb };
}

describe("sonnen FSM", () => {
	it("sets discharge to zero for a price hold and restores self consumption on expiry", () => {
		let rt = initialSonnenRuntime(0);
		const held = drive(rt, () => ({ action: "hold", requestId: "price-bridge-1",
			effectiveChargeW: 0, actualChargingW: 0, actualDischargingW: 0,
			actualMode: MODE.selfConsumption, gridBalanceActive: true }), 4, 0);
		rt = held.rt;
		const active = drive(rt, () => ({ action: "hold", requestId: "price-bridge-1",
			effectiveChargeW: 0, actualChargingW: 0, actualDischargingW: 0,
			actualMode: MODE.manual }), 8, 4000);
		assert.equal(active.rt.state, "active");
		assert.deepEqual(active.writes.filter(w => w.kind === "discharge_power").map(w => w.value), [0]);
		assert.equal(active.writes.filter(w => w.kind === "charge_power").length, 0);
		const restored = drive(active.rt, cur => ({ action: "self_consumption", stopReason: "intent_expired",
			chargingActionRequested: false, actualDischargingW: 0,
			actualMode: cur.state === "verify_self_consumption" || cur.state === "restore_grid_balance"
				? MODE.selfConsumption : MODE.manual }), 8, 12000);
		assert.equal(restored.rt.ownership.active, false);
		assert.ok(restored.writes.some(w => w.kind === "operating_mode" && w.value === MODE.selfConsumption));
		assert.equal(restored.writes.filter(w => w.kind === "charge_power").length, 0);
	});

	it("runs full live charge sequence in correct write order", () => {
		const rt = initialSonnenRuntime(0);
		const res = drive(
			rt,
			(cur) => ({
				actualMode:
					cur.state === "verify_manual_mode" || cur.state === "set_charge_power" || cur.state === "verify_charge_power" || cur.state === "active"
						? MODE.manual
						: MODE.selfConsumption,
				actualChargingW:
					cur.state === "verify_charge_power" || cur.state === "active" ? 2000 : 0,
			}),
			12,
			0,
		);
		assert.equal(res.rt.state, "active");
		assert.equal(res.writes.length, 2);
		assert.equal(res.writes[0].kind, "operating_mode");
		assert.equal(res.writes[0].value, MODE.manual);
		assert.equal(res.writes[1].kind, "charge_power");
		assert.equal(res.writes[1].value, 2000);
		assert.ok(res.gb.includes("pause"));
		assert.equal(res.rt.ownership.active, true);
	});

	it("skips manual mode write when device already in manual", () => {
		const rt = initialSonnenRuntime(0);
		const res = drive(
			rt,
			(cur) => ({
				actualMode: MODE.manual,
				actualChargingW: cur.state === "verify_charge_power" || cur.state === "active" ? 2000 : 0,
			}),
			14,
			0,
		);
		assert.equal(res.rt.state, "active");
		const modeWrites = res.writes.filter((w) => w.kind === "operating_mode");
		assert.equal(modeWrites.length, 0);
		assert.ok(res.writes.some((w) => w.kind === "charge_power"));
	});

	it("dryrun simulates feedback to reach active", () => {
		const rt = initialSonnenRuntime(0);
		const res = drive(rt, () => ({ simulateFeedback: true, actualMode: null, actualChargingW: null }), 12, 0);
		assert.equal(res.rt.state, "active");
	});

	it("stop and restore on intent revoke", () => {
		let rt = initialSonnenRuntime(0);
		rt = drive(rt, () => ({ gridBalanceActive: true }), 12, 0).rt;
		assert.equal(rt.state, "active");
		const res = drive(
			rt,
			(cur) => ({
				chargingActionRequested: false,
				intentValid: false,
				stopReason: "intent_revoked",
				actualChargingW: 0,
				actualMode:
					cur.state === "verify_self_consumption" || cur.state === "restore_grid_balance" || cur.state === "completed"
						? MODE.selfConsumption
						: MODE.manual,
			}),
			8,
			20_000,
		);
		assert.equal(res.rt.state, "completed");
		assert.equal(res.rt.ownership.active, false);
		const modeWrites = res.writes.filter((w) => w.kind === "operating_mode");
		assert.equal(modeWrites[modeWrites.length - 1].value, MODE.selfConsumption);
		assert.ok(res.gb.includes("restore"));
		assert.ok(res.writes.some((w) => w.kind === "charge_power" && w.value === 0));
	});

	it("regular stop writes 0 W even when telemetry already shows 0", () => {
		let rt = initialSonnenRuntime(0);
		rt = drive(rt, () => ({}), 12, 0).rt;
		assert.equal(rt.state, "active");
		const res = drive(
			rt,
			() => ({
				chargingActionRequested: false,
				intentValid: false,
				stopReason: "intent_revoked",
				actualChargingW: 0,
				actualMode: MODE.manual,
			}),
			2,
			20_000,
		);
		assert.equal(res.writes.filter((w) => w.kind === "charge_power" && w.value === 0).length, 1);
		assert.equal(res.rt.state, "verify_charge_stopped");
	});

	it("hold handover drops ownership without 0 W or mode restore", () => {
		let rt = initialSonnenRuntime(0);
		rt = drive(rt, () => ({}), 12, 0).rt;
		assert.equal(rt.state, "active");
		assert.equal(rt.ownership.active, true);
		const res = drive(
			rt,
			() => ({
				chargingActionRequested: false,
				intentValid: false,
				stopReason: "authority_hold",
				stopDisposition: "drop_ownership",
				actualChargingW: 2000,
				actualMode: MODE.manual,
			}),
			2,
			20_000,
		);
		assert.equal(res.rt.state, "completed");
		assert.equal(res.rt.ownership.active, false);
		assert.equal(
			res.writes.filter((w) => w.kind === "charge_power" && w.value === 0).length,
			0,
		);
		assert.equal(res.writes.filter((w) => w.kind === "operating_mode").length, 0);
	});

	it("external handover drops ownership without competing 0 W", () => {
		let rt = initialSonnenRuntime(0);
		rt = drive(rt, () => ({}), 12, 0).rt;
		const res = drive(
			rt,
			() => ({
				stopReason: "authority_external",
				stopDisposition: "drop_ownership",
				actualChargingW: 2000,
				actualMode: MODE.manual,
			}),
			2,
			20_000,
		);
		assert.equal(res.rt.ownership.active, false);
		assert.equal(res.writes.some((w) => w.kind === "charge_power" && w.value === 0), false);
	});

	it("mode feedback timeout → fault → restore → lockout", () => {
		let rt = initialSonnenRuntime(0);
		// advance to verify_manual_mode without confirming
		rt = drive(rt, () => ({ actualMode: MODE.selfConsumption }), 7, 0).rt;
		assert.equal(rt.state, "verify_manual_mode");
		// force timeout: large elapsed, mode never confirms; then drive restore with self confirmation
		const res = drive(
			rt,
			(cur) =>
				cur.state === "verify_self_consumption"
					? { actualMode: MODE.selfConsumption, actualChargingW: 0 }
					: { actualMode: MODE.selfConsumption, actualChargingW: 0 },
			10,
			100_000,
		);
		assert.equal(res.rt.lockout, true);
		assert.equal(res.rt.faultCode, "mode_feedback_timeout");
		assert.equal(res.rt.state, "lockout");
	});
});
