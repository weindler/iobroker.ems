import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAcCoolingDiagLine, type AcCoolingDiagSnapshot } from "./diag_trace";

function snap(over: Partial<AcCoolingDiagSnapshot> = {}): AcCoolingDiagSnapshot {
	return {
		tag: "stop",
		unitIndex: 1,
		nowMs: Date.parse("2026-08-11T09:30:28.000Z"),
		slotStartIso: "2026-08-11T09:30:00.000Z",
		slotEndIso: "2026-08-11T09:45:00.000Z",
		allocatedPowerW: 850,
		dailyPlanRevision: 42,
		dailyPlanStatus: "daily_plan_valid",
		desired: "off",
		lastDesired: "on",
		commandGeneration: 3,
		stopArmedGeneration: 3,
		feedback: "on",
		decisionSource: "daily_plan",
		allowStart: false,
		allowStop: true,
		demandStop: false,
		plannerOff: true,
		reasonDe: "Daily Plan: keine aktive Allocation für air_conditioning.unit_1 (0 W).",
		...over,
	};
}

describe("formatAcCoolingDiagLine", () => {
	it("includes transition fields in one compact line", () => {
		const line = formatAcCoolingDiagLine(snap({ allocatedPowerW: 0 }));
		assert.match(line, /diag stop/);
		assert.match(line, /allocW=0/);
		assert.match(line, /rev=42/);
		assert.match(line, /desired=off/);
		assert.match(line, /lastDesired=on/);
		assert.match(line, /cmdGen=3/);
		assert.match(line, /stopGen=3/);
		assert.match(line, /fb=on/);
		assert.match(line, /plannerOff=true/);
		assert.match(line, /demandStop=false/);
		assert.match(line, /allowStop=true/);
	});

	it("marks missing allocation fields without inventing zeros", () => {
		const line = formatAcCoolingDiagLine(
			snap({
				tag: "start",
				allocatedPowerW: null,
				dailyPlanRevision: null,
				slotStartIso: null,
				slotEndIso: null,
				stopArmedGeneration: null,
				lastDesired: null,
			}),
		);
		assert.match(line, /diag start/);
		assert.match(line, /allocW=null/);
		assert.match(line, /rev=null/);
		assert.match(line, /slot=none/);
		assert.match(line, /stopGen=null/);
		assert.match(line, /lastDesired=null/);
	});
});
