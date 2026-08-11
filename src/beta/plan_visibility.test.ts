import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	chartStartsAbsentFromPlan,
	climateUnitTimelineWindowsFromPlanJson,
	collectPlanVisSlots,
	collapsePlanVisWindows,
	firstOpenPlanVisWindow,
	immersionTimelineWindowsFromPlanJson,
	nextPlanVisWindow,
} from "./plan_visibility";
import {
	isEffectiveLiveWriteAllowed,
	resolveClimateUnitDisplay,
	resolveExecutionAuthority,
} from "./execution_display";

const NOW = Date.parse("2026-08-09T05:35:00.000Z"); // 07:35 Europe/Berlin summer

function ihEntry(startIso: string, powerW: number, endIso?: string) {
	const startMs = Date.parse(startIso);
	const end = endIso ?? new Date(startMs + 15 * 60_000).toISOString();
	return {
		contributionId: "immersion_heater.flexible",
		allocatedPowerW: powerW,
		slot: { startIso, endIso: end },
	};
}

function acEntry(unit: number, startIso: string, powerW: number, endIso?: string) {
	const startMs = Date.parse(startIso);
	const end = endIso ?? new Date(startMs + 15 * 60_000).toISOString();
	return {
		contributionId: `air_conditioning.unit_${unit}`,
		allocatedPowerW: powerW,
		slot: { startIso, endIso: end },
	};
}

describe("plan_visibility — Heizstab autoritative Timeline", () => {
	it("A: Chart 07:30 without plan_json slot → not an authoritative GEPLANT window", () => {
		const planJson = JSON.stringify([ihEntry("2026-08-09T08:30:00.000Z", 1700)]); // 10:30 Berlin
		const windows = immersionTimelineWindowsFromPlanJson(planJson, NOW);
		const chartStart = Date.parse("2026-08-09T05:30:00.000Z"); // 07:30 Berlin
		const absent = chartStartsAbsentFromPlan([chartStart], windows);
		assert.deepEqual(absent, [chartStart]);
		assert.equal(
			windows.some((w) => w.startMs === chartStart),
			false,
		);
	});

	it("B: next authoritative slot 10:30 / 1700 W is the first open window", () => {
		const planJson = JSON.stringify([
			ihEntry("2026-08-09T08:30:00.000Z", 1700),
			ihEntry("2026-08-09T08:45:00.000Z", 1700),
		]);
		const windows = immersionTimelineWindowsFromPlanJson(planJson, NOW);
		const first = firstOpenPlanVisWindow(windows, NOW);
		assert.ok(first);
		assert.equal(first!.startIso, "2026-08-09T08:30:00.000Z");
		assert.equal(first!.powerW, 1700);
	});

	it("C: no maxW leak — early low-power range keeps own W, not later 1700", () => {
		const slots = collectPlanVisSlots(
			JSON.stringify([
				ihEntry("2026-08-09T06:00:00.000Z", 500),
				ihEntry("2026-08-09T08:30:00.000Z", 1700),
			]),
			{ nowMs: Date.parse("2026-08-09T05:00:00.000Z") },
		);
		const windows = collapsePlanVisWindows(slots);
		assert.equal(windows.length, 2);
		assert.equal(windows[0]!.powerW, 500);
		assert.equal(windows[1]!.powerW, 1700);
	});
});

describe("plan_visibility — Klima Future plan_json", () => {
	it("D: outside window + future allocation → Gesperrt + next plan visible", () => {
		const planJson = JSON.stringify([
			acEntry(1, "2026-08-09T09:00:00.000Z", 700),
			acEntry(1, "2026-08-09T09:15:00.000Z", 700),
		]);
		const wins = climateUnitTimelineWindowsFromPlanJson(planJson, 1, NOW);
		const next = nextPlanVisWindow(wins, NOW);
		assert.ok(next);
		const d = resolveClimateUnitDisplay({
			liveWriteAllowed: true,
			hardwareRunning: false,
			allocatedPowerW: 0,
			reasonDe: "Außerhalb Zeitfenster 08:00–20:00.",
			likelyActiveToday: false,
			hasFuturePlan: true,
			nextPlanWindow: next,
			timezone: "UTC",
		});
		assert.match(d.operationLabelDe, /Gesperrt/);
		assert.match(d.planLineDe, /nächstes/);
		assert.match(d.planLineDe, /700/);
	});

	it("E: outside window + no future allocation → kein Budget", () => {
		const wins = climateUnitTimelineWindowsFromPlanJson("[]", 1, NOW);
		assert.equal(wins.length, 0);
		const d = resolveClimateUnitDisplay({
			liveWriteAllowed: true,
			hardwareRunning: false,
			allocatedPowerW: 0,
			reasonDe: "Außerhalb Zeitfenster 08:00–20:00.",
			hasFuturePlan: false,
			nextPlanWindow: null,
		});
		assert.equal(d.planLineDe, "kein Budget");
		assert.equal(d.heuteLineDe, "heute keine geplante Klimaaktion");
	});

	it("F: future plan separated per AC unit", () => {
		const planJson = JSON.stringify([
			acEntry(1, "2026-08-09T09:00:00.000Z", 700),
			acEntry(2, "2026-08-09T12:00:00.000Z", 900),
		]);
		const u1 = climateUnitTimelineWindowsFromPlanJson(planJson, 1, NOW);
		const u2 = climateUnitTimelineWindowsFromPlanJson(planJson, 2, NOW);
		assert.equal(u1.length, 1);
		assert.equal(u1[0]!.powerW, 700);
		assert.equal(u2.length, 1);
		assert.equal(u2[0]!.powerW, 900);
		assert.notEqual(u1[0]!.startIso, u2[0]!.startIso);
	});

	it("G: Execution LIVE/DRYRUN independent of Gesperrt operation", () => {
		assert.equal(isEffectiveLiveWriteAllowed("live", "live"), true);
		assert.equal(resolveExecutionAuthority(true), "live");
		assert.equal(resolveExecutionAuthority(false), "dryrun");
		const d = resolveClimateUnitDisplay({
			liveWriteAllowed: true,
			hardwareRunning: false,
			allocatedPowerW: 0,
			reasonDe: "Außerhalb Zeitfenster 08:00–20:00.",
			hasFuturePlan: true,
			nextPlanWindow: {
				startIso: "2026-08-09T09:00:00.000Z",
				endIso: "2026-08-09T09:15:00.000Z",
				startMs: Date.parse("2026-08-09T09:00:00.000Z"),
				endMs: Date.parse("2026-08-09T09:15:00.000Z"),
				powerW: 700,
				contributionId: "air_conditioning.unit_1",
			},
		});
		assert.match(d.operationLabelDe, /Gesperrt/);
		assert.equal(resolveExecutionAuthority(true), "live");
	});
});
