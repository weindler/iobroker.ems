"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const plan_visibility_1 = require("./plan_visibility");
const execution_display_1 = require("./execution_display");
const NOW = Date.parse("2026-08-09T05:35:00.000Z"); // 07:35 Europe/Berlin summer
function ihEntry(startIso, powerW, endIso) {
    const startMs = Date.parse(startIso);
    const end = endIso ?? new Date(startMs + 15 * 60_000).toISOString();
    return {
        contributionId: "immersion_heater.flexible",
        allocatedPowerW: powerW,
        slot: { startIso, endIso: end },
    };
}
function acEntry(unit, startIso, powerW, endIso) {
    const startMs = Date.parse(startIso);
    const end = endIso ?? new Date(startMs + 15 * 60_000).toISOString();
    return {
        contributionId: `air_conditioning.unit_${unit}`,
        allocatedPowerW: powerW,
        slot: { startIso, endIso: end },
    };
}
(0, node_test_1.describe)("plan_visibility — Heizstab autoritative Timeline", () => {
    (0, node_test_1.it)("A: Chart 07:30 without plan_json slot → not an authoritative GEPLANT window", () => {
        const planJson = JSON.stringify([ihEntry("2026-08-09T08:30:00.000Z", 1700)]); // 10:30 Berlin
        const windows = (0, plan_visibility_1.immersionTimelineWindowsFromPlanJson)(planJson, NOW);
        const chartStart = Date.parse("2026-08-09T05:30:00.000Z"); // 07:30 Berlin
        const absent = (0, plan_visibility_1.chartStartsAbsentFromPlan)([chartStart], windows);
        strict_1.default.deepEqual(absent, [chartStart]);
        strict_1.default.equal(windows.some((w) => w.startMs === chartStart), false);
    });
    (0, node_test_1.it)("B: next authoritative slot 10:30 / 1700 W is the first open window", () => {
        const planJson = JSON.stringify([
            ihEntry("2026-08-09T08:30:00.000Z", 1700),
            ihEntry("2026-08-09T08:45:00.000Z", 1700),
        ]);
        const windows = (0, plan_visibility_1.immersionTimelineWindowsFromPlanJson)(planJson, NOW);
        const first = (0, plan_visibility_1.firstOpenPlanVisWindow)(windows, NOW);
        strict_1.default.ok(first);
        strict_1.default.equal(first.startIso, "2026-08-09T08:30:00.000Z");
        strict_1.default.equal(first.powerW, 1700);
    });
    (0, node_test_1.it)("C: no maxW leak — early low-power range keeps own W, not later 1700", () => {
        const slots = (0, plan_visibility_1.collectPlanVisSlots)(JSON.stringify([
            ihEntry("2026-08-09T06:00:00.000Z", 500),
            ihEntry("2026-08-09T08:30:00.000Z", 1700),
        ]), { nowMs: Date.parse("2026-08-09T05:00:00.000Z") });
        const windows = (0, plan_visibility_1.collapsePlanVisWindows)(slots);
        strict_1.default.equal(windows.length, 2);
        strict_1.default.equal(windows[0].powerW, 500);
        strict_1.default.equal(windows[1].powerW, 1700);
    });
});
(0, node_test_1.describe)("plan_visibility — Klima Future plan_json", () => {
    (0, node_test_1.it)("D: outside window + future allocation → Gesperrt + next plan visible", () => {
        const planJson = JSON.stringify([
            acEntry(1, "2026-08-09T09:00:00.000Z", 700, "2026-08-09T11:00:00.000Z"),
        ]);
        const wins = (0, plan_visibility_1.climateUnitTimelineWindowsFromPlanJson)(planJson, 1, NOW);
        const next = (0, plan_visibility_1.nextPlanVisWindow)(wins, NOW);
        strict_1.default.ok(next);
        const d = (0, execution_display_1.resolveClimateUnitDisplay)({
            liveWriteAllowed: true,
            hardwareRunning: false,
            allocatedPowerW: 0,
            reasonDe: "Außerhalb Zeitfenster 08:00–20:00.",
            likelyActiveToday: false,
            hasFuturePlan: true,
            nextPlanWindow: next,
            timezone: "UTC",
        });
        strict_1.default.match(d.operationLabelDe, /Gesperrt/);
        strict_1.default.match(d.planLineDe, /nächstes/);
        strict_1.default.match(d.planLineDe, /700/);
    });
    (0, node_test_1.it)("E: outside window + no future allocation → kein Budget", () => {
        const wins = (0, plan_visibility_1.climateUnitTimelineWindowsFromPlanJson)("[]", 1, NOW);
        strict_1.default.equal(wins.length, 0);
        const d = (0, execution_display_1.resolveClimateUnitDisplay)({
            liveWriteAllowed: true,
            hardwareRunning: false,
            allocatedPowerW: 0,
            reasonDe: "Außerhalb Zeitfenster 08:00–20:00.",
            hasFuturePlan: false,
            nextPlanWindow: null,
        });
        strict_1.default.equal(d.planLineDe, "kein Budget");
        strict_1.default.equal(d.heuteLineDe, "heute keine geplante Klimaaktion");
    });
    (0, node_test_1.it)("F: future plan separated per AC unit", () => {
        const planJson = JSON.stringify([
            acEntry(1, "2026-08-09T09:00:00.000Z", 700),
            acEntry(2, "2026-08-09T12:00:00.000Z", 900),
        ]);
        const u1 = (0, plan_visibility_1.climateUnitTimelineWindowsFromPlanJson)(planJson, 1, NOW);
        const u2 = (0, plan_visibility_1.climateUnitTimelineWindowsFromPlanJson)(planJson, 2, NOW);
        strict_1.default.equal(u1.length, 1);
        strict_1.default.equal(u1[0].powerW, 700);
        strict_1.default.equal(u2.length, 1);
        strict_1.default.equal(u2[0].powerW, 900);
        strict_1.default.notEqual(u1[0].startIso, u2[0].startIso);
    });
    (0, node_test_1.it)("G: Execution LIVE/DRYRUN independent of Gesperrt operation", () => {
        strict_1.default.equal((0, execution_display_1.isEffectiveLiveWriteAllowed)("live", "live"), true);
        strict_1.default.equal((0, execution_display_1.resolveExecutionAuthority)(true), "live");
        strict_1.default.equal((0, execution_display_1.resolveExecutionAuthority)(false), "dryrun");
        const d = (0, execution_display_1.resolveClimateUnitDisplay)({
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
        strict_1.default.match(d.operationLabelDe, /Gesperrt/);
        strict_1.default.equal((0, execution_display_1.resolveExecutionAuthority)(true), "live");
    });
});
