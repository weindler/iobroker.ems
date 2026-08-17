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
import { buildPlannerConstraints } from "../../operator/planning/battery.js";

const SRC = join(__dirname, "..", "..", "..", "src", "addons", "battery");
const PLANNER_BATTERY_SRC = join(
	__dirname,
	"..",
	"..",
	"..",
	"src",
	"operator",
	"planning",
	"battery.ts",
);
const TICK_SRC = join(__dirname, "..", "..", "..", "src", "operator", "daily_plan", "tick.ts");
const NOW = Date.parse("2026-08-17T12:00:00.000Z");

function signals(overrides: Partial<Parameters<typeof resolveGridBalanceHoldSignals>[0]> = {}) {
	return resolveGridBalanceHoldSignals({
		nowMs: NOW,
		constraintHoldState: { val: false, ts: NOW },
		deviceIntentHold: false,
		batteryHoldForEvCharge: false,
		evccBatteryMode: "normal",
		...overrides,
	});
}

describe("grid balance hold freshness", () => {
	it("stale constraint true + live holds false → hold_detected false", () => {
		const r = signals({
			constraintHoldState: { val: true, ts: NOW - 40 * 24 * 3600_000 },
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
		const r = signals({
			constraintHoldState: { val: true, ts: NOW - 60_000 },
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
		const r = signals({
			constraintHoldState: { val: true, ts: NOW - 40 * 24 * 3600_000 },
			batteryHoldForEvCharge: true,
		});
		assert.equal(r.constraintHoldFresh, false);
		assert.equal(r.holdDetected, true);
	});

	it("deviceIntent hold is current", () => {
		const r = signals({ deviceIntentHold: true });
		assert.equal(r.holdPlanned, true);
		assert.equal(r.holdDetected, true);
	});

	it("battery_mode unknown/normal is not a hold (discharge control is not a GB hold input)", () => {
		assert.equal(signals({ evccBatteryMode: "unknown" }).holdDetected, false);
		assert.equal(signals({ evccBatteryMode: "normal" }).holdDetected, false);
		const gb = readFileSync(join(SRC, "hold_freshness.ts"), "utf8");
		assert.equal(gb.includes("evccDischargeControl"), false);
		assert.equal(gb.includes("battery_discharge_control"), false);
		const idx = readFileSync(join(SRC, "index.ts"), "utf8");
		assert.equal(idx.includes("batteryDischargeControl"), false);
		const planner = readFileSync(PLANNER_BATTERY_SRC, "utf8");
		assert.equal(planner.includes("modeHold || dischargeControl"), false);
		assert.match(planner, /const batteryHoldActive = modeHold \|\| userHold \|\| wallboxHold;/);
	});

	it("EVCC battery_mode hold is a current hold", () => {
		assert.equal(isEvccBatteryHoldMode("hold"), true);
		const r = signals({ evccBatteryMode: "hold" });
		assert.equal(r.evccBatteryModeHold, true);
		assert.equal(r.holdDetected, true);
	});

	it("EVCC battery_mode holdcharge is a current hold", () => {
		assert.equal(isEvccBatteryHoldMode("holdcharge"), true);
		assert.equal(isEvccBatteryHoldMode("HOLDCHARGE"), true);
		assert.equal(isEvccBatteryHoldMode("normal"), false);
		assert.equal(isEvccBatteryHoldMode(""), false);
		const r = signals({ evccBatteryMode: "holdcharge" });
		assert.equal(r.evccBatteryModeHold, true);
		assert.equal(r.holdDetected, true);
	});

	it("battery_hold_for_ev_charge true is a current hold", () => {
		assert.equal(signals({ batteryHoldForEvCharge: true }).holdDetected, true);
	});

	it("stale constraint older than 15 min is not hold_detected", () => {
		const r = signals({
			constraintHoldState: { val: true, ts: NOW - PLANNER_HOLD_CONSTRAINT_MAX_AGE_MS - 1 },
		});
		assert.equal(r.constraintHoldFresh, false);
		assert.equal(r.holdDetected, false);
	});

	it("planner does not mint battery_hold_active from discharge control alone", () => {
		for (const mode of ["unknown", "normal", "charge"]) {
			const c = buildPlannerConstraints({
				evccBatteryMode: mode,
				evccBatteryDischargeControl: true,
				userIntentBatteryHold: false,
			});
			assert.equal(c.battery_hold_active, false, mode);
			assert.equal(c.evcc_battery_hold, false, mode);
			assert.equal(c.evcc_battery_discharge_control, true, mode);
		}
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
