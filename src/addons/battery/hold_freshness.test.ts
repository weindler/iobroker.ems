import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	PLANNER_HOLD_CONSTRAINT_MAX_AGE_MS,
	isEvccBatteryHoldMode,
	isFreshTrue,
	resolveGridBalanceHoldSignals,
} from "./hold_freshness.js";
import { GRID_BALANCE_EXECUTION_ENABLED } from "./grid_balance_contract.js";
import { EV_EXECUTION_PHASE5_ENABLED } from "../wallbox/ev_foundation/write_allowlist.js";

const SRC = join(__dirname, "..", "..", "..", "src", "addons", "battery");
const TICK_SRC = join(__dirname, "..", "..", "..", "src", "operator", "daily_plan", "tick.ts");
const NOW = Date.parse("2026-08-17T12:00:00.000Z");

describe("grid balance hold freshness", () => {
	it("stale constraint true + live holds false → hold_detected false", () => {
		const r = resolveGridBalanceHoldSignals({
			nowMs: NOW,
			constraintHoldState: { val: true, ts: NOW - 40 * 24 * 3600_000 },
			deviceIntentHold: false,
			batteryHoldForEvCharge: false,
			evccBatteryMode: "normal",
			evccDischargeControl: false,
		});
		assert.equal(r.constraintHoldFresh, false);
		assert.equal(r.holdActive, false);
		assert.equal(r.holdDetected, false);
	});

	it("constraint true without ts is not current", () => {
		assert.equal(isFreshTrue({ val: true }, NOW), false);
		assert.equal(isFreshTrue({ val: true, ts: Number.NaN }, NOW), false);
		assert.equal(isFreshTrue(null, NOW), false);
	});

	it("fresh constraint true is a current hold", () => {
		const r = resolveGridBalanceHoldSignals({
			nowMs: NOW,
			constraintHoldState: { val: true, ts: NOW - 60_000 },
			deviceIntentHold: false,
			batteryHoldForEvCharge: false,
			evccBatteryMode: "normal",
			evccDischargeControl: false,
		});
		assert.equal(r.constraintHoldFresh, true);
		assert.equal(r.holdDetected, true);
	});

	it("fresh true older than max age is stale", () => {
		assert.equal(
			isFreshTrue({ val: true, ts: NOW - PLANNER_HOLD_CONSTRAINT_MAX_AGE_MS - 1 }, NOW),
			false,
		);
		assert.equal(isFreshTrue({ val: true, ts: NOW - PLANNER_HOLD_CONSTRAINT_MAX_AGE_MS }, NOW), true);
	});

	it("live EV-charge hold is current even if constraint is stale", () => {
		const r = resolveGridBalanceHoldSignals({
			nowMs: NOW,
			constraintHoldState: { val: true, ts: NOW - 40 * 24 * 3600_000 },
			deviceIntentHold: false,
			batteryHoldForEvCharge: true,
			evccBatteryMode: "normal",
			evccDischargeControl: false,
		});
		assert.equal(r.constraintHoldFresh, false);
		assert.equal(r.holdDetected, true);
	});

	it("deviceIntent hold is current", () => {
		const r = resolveGridBalanceHoldSignals({
			nowMs: NOW,
			constraintHoldState: { val: false, ts: NOW },
			deviceIntentHold: true,
			batteryHoldForEvCharge: false,
			evccBatteryMode: "normal",
			evccDischargeControl: false,
		});
		assert.equal(r.holdPlanned, true);
		assert.equal(r.holdDetected, true);
	});

	it("EVCC battery_mode hold and holdcharge are current holds", () => {
		assert.equal(isEvccBatteryHoldMode("hold"), true);
		assert.equal(isEvccBatteryHoldMode("holdcharge"), true);
		assert.equal(isEvccBatteryHoldMode("HOLDCHARGE"), true);
		assert.equal(isEvccBatteryHoldMode("normal"), false);
		assert.equal(isEvccBatteryHoldMode(""), false);
		const r = resolveGridBalanceHoldSignals({
			nowMs: NOW,
			constraintHoldState: { val: false, ts: NOW },
			deviceIntentHold: false,
			batteryHoldForEvCharge: false,
			evccBatteryMode: "holdcharge",
			evccDischargeControl: false,
		});
		assert.equal(r.evccBatteryModeHold, true);
		assert.equal(r.holdDetected, true);
	});

	it("daily plan always refreshes hold constraints; GB ignores stale ts", () => {
		const tick = readFileSync(TICK_SRC, "utf8");
		assert.match(tick, /host\.setStateAsync\(\s*"planner\.constraints\.battery_hold_active"/);
		assert.match(tick, /host\.setStateAsync\(\s*"planner\.constraints\.evcc_battery_hold"/);
		assert.equal(tick.includes('setStateIfChanged(host, "planner.constraints.battery_hold_active"'), false);
		assert.equal(tick.includes('setStateIfChanged(host, "planner.constraints.evcc_battery_hold"'), false);

		const idx = readFileSync(join(SRC, "index.ts"), "utf8");
		assert.match(idx, /resolveGridBalanceHoldSignals/);
		assert.match(idx, /constraintHoldState/);
		assert.equal(GRID_BALANCE_EXECUTION_ENABLED, false);
		assert.equal(EV_EXECUTION_PHASE5_ENABLED, false);
	});
});
