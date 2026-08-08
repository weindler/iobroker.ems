/**
 * Beta-Befund 003: strategischer Planstatus + Execution/Operation-Trennung + Agenda.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { operatorQuality } from "../operator/quality";
import type { UnifiedDayPlan } from "../operator/daily_plan/unified/types";
import {
	executionAuthorityBadge,
	isEffectiveLiveWriteAllowed,
	operationFromBatteryStrategy,
	operationFromWallboxStrategy,
	resolveExecutionAuthority,
	resolveExecutionDisplayPhase,
} from "./execution_display";
import {
	buildUnifiedDayAgendaDe,
	mergeWindows,
	selectRelevantAgendaWindows,
} from "./product_summary";
import {
	deriveBatteryStrategicStatus,
	deriveWallboxStrategicStatus,
} from "./strategic_status";

const Q = operatorQuality("valid", "test");

function emptyPlan(overrides: Partial<UnifiedDayPlan> = {}): UnifiedDayPlan {
	return {
		schemaVersion: 1,
		planId: "t",
		generation: 1,
		inputRevision: 1,
		createdAtIso: "2026-08-08T12:00:00.000Z",
		timezone: "Europe/Berlin",
		horizonStartIso: "2026-08-08T10:00:00.000Z",
		horizonEndIso: "2026-08-09T18:00:00.000Z",
		slotMinutes: 15,
		expectedPvEnergyTodayKwh: 40,
		expectedHouseLoadEnergyTodayKwh: 20,
		expectedPvEnergyToGoalKwh: null,
		expectedPvEnergyHorizonKwh: 80,
		expectedHouseLoadEnergyHorizonKwh: 40,
		expectedGridImportEnergyKwh: 0,
		expectedGridExportEnergyKwh: 5,
		expectedCostCt: null,
		batteryTrajectory: [],
		allocations: [],
		goalStatuses: [],
		constraints: [],
		reasonCodes: [],
		confidence: Q,
		vehicleChargeEconomics: null,
		totals: null,
		legacyDailyPlan: null,
		...overrides,
	};
}

describe("Beta-Befund 003 — Battery strategic status", () => {
	it("SOC 100 %, keine Charge-Allocation → reserve_protected bei Nachtreserve", () => {
		const plan = emptyPlan({
			reasonCodes: ["battery_night_reserve", "battery_reserve_protected"],
			constraints: [
				{
					id: "battery.night_reserve",
					kind: "policy",
					hard: true,
					descriptionDe: "Nachtreserve schützen.",
				},
			],
		});
		const s = deriveBatteryStrategicStatus({
			plan,
			socPct: 100,
			minSocPct: 10,
			maxSocPct: 100,
			nightReserveKwh: 4,
			usableCapacityKwh: 10,
			batteryHold: false,
			dischargeLiveSupported: false,
			nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
		});
		assert.equal(s.status, "reserve_protected");
		assert.match(s.summaryDe, /Reserve|voll|SOC 100/i);
		assert.equal(s.hasChargeAllocation, false);
	});

	it("Night Reserve aktiv → reserve_protected", () => {
		const s = deriveBatteryStrategicStatus({
			plan: emptyPlan({ reasonCodes: ["battery_night_reserve"] }),
			socPct: 55,
			minSocPct: 10,
			maxSocPct: 100,
			nightReserveKwh: 5,
			usableCapacityKwh: 10,
			batteryHold: false,
			dischargeLiveSupported: false,
			nowMs: Date.parse("2026-08-08T20:00:00.000Z"),
		});
		assert.equal(s.status, "reserve_protected");
	});

	it("Hold-Entscheidung sichtbar ohne Write", () => {
		const s = deriveBatteryStrategicStatus({
			plan: emptyPlan(),
			socPct: 70,
			minSocPct: 10,
			maxSocPct: 100,
			nightReserveKwh: null,
			usableCapacityKwh: 10,
			batteryHold: true,
			dischargeLiveSupported: false,
			nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
		});
		assert.equal(s.status, "hold");
		assert.match(s.reasonDe, /Hold/i);
		const op = operationFromBatteryStrategy(s.status, false);
		assert.equal(op.kind, "hold");
	});
});

describe("Beta-Befund 003 — Wallbox strategic status", () => {
	it("ohne Fahrzeug → waiting_for_vehicle", () => {
		const s = deriveWallboxStrategicStatus({
			plan: emptyPlan(),
			connectedNow: false,
			requiredEnergyKwh: null,
			deadlineIso: null,
			hasHardFuturePresence: false,
			nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
		});
		assert.equal(s.status, "waiting_for_vehicle");
		assert.match(s.summaryDe, /Fahrzeug|kein Ladeplan/i);
		assert.equal(s.hasChargeAllocation, false);
	});

	it("Fahrzeug + Goal/Deadline + future Allocation → scheduled", () => {
		const plan = emptyPlan({
			allocations: [
				{
					slot: {
						startIso: "2026-08-08T16:00:00.000Z",
						endIso: "2026-08-08T16:15:00.000Z",
					},
					consumerId: "wallbox",
					kind: "wallbox",
					allocatedPowerW: 7000,
					allocatedEnergyKwh: 1.75,
					energySource: "pv_surplus",
					constraintIds: [],
					reasonCodes: [],
				},
			],
			vehicleChargeEconomics: {
				deadlineIso: "2026-08-08T18:00:00.000Z",
				requiredEnergyKwh: 10,
				expectedPvChargeKwh: 8,
				expectedGridChargeKwh: 2,
				expectedGridCostCt: 40,
				alternativeGridCostCt: 60,
				savingsVsAlternativeCt: 20,
				exportTariffKnown: false,
				economicsCompleteness: "grid_only",
				baselineId: "earliest_feasible",
				slotCostsCtByStartIso: {},
			},
		});
		const s = deriveWallboxStrategicStatus({
			plan,
			connectedNow: true,
			requiredEnergyKwh: 10,
			deadlineIso: "2026-08-08T18:00:00.000Z",
			hasHardFuturePresence: true,
			nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
		});
		assert.equal(s.status, "scheduled");
		assert.equal(s.hasChargeAllocation, true);
		assert.equal(operationFromWallboxStrategy(s.status, false).kind, "planned");
	});
});

describe("Beta-Befund 003 — Execution vs Operation", () => {
	it("Add-on Dryrun + keine Allocation → DRYRUN bleibt sichtbar", () => {
		assert.equal(isEffectiveLiveWriteAllowed("live", "dryrun"), false);
		assert.equal(resolveExecutionAuthority(false), "dryrun");
		assert.equal(executionAuthorityBadge("dryrun").labelDe, "DRYRUN");
		const agenda = buildUnifiedDayAgendaDe(
			emptyPlan({
				reasonCodes: ["battery_night_reserve"],
				constraints: [
					{
						id: "battery.night_reserve",
						kind: "policy",
						hard: true,
						descriptionDe: "Nachtreserve.",
					},
				],
			}),
			{
				nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
				battery: { liveWriteAllowed: false, hardwareActive: false, currentAllocatedW: null },
				wallbox: { liveWriteAllowed: false, hardwareActive: false, currentAllocatedW: null },
			},
			{
				schemaVersion: 1,
				generatedAtIso: "2026-08-08T14:00:00.000Z",
				battery: deriveBatteryStrategicStatus({
					plan: emptyPlan({ reasonCodes: ["battery_night_reserve"] }),
					socPct: 100,
					minSocPct: 10,
					maxSocPct: 100,
					nightReserveKwh: 4,
					usableCapacityKwh: 10,
					batteryHold: false,
					dischargeLiveSupported: false,
					nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
				}),
				wallbox: deriveWallboxStrategicStatus({
					plan: emptyPlan(),
					connectedNow: false,
					requiredEnergyKwh: null,
					deadlineIso: null,
					hasHardFuturePresence: false,
					nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
				}),
			},
		);
		const batLine = agenda.find((l) => /Batterie/i.test(l)) ?? "";
		assert.match(batLine, /^DRYRUN/);
		assert.doesNotMatch(batLine, /PAUSIERT/i);
	});

	it("Add-on Live + keine Aktion → LIVE + operativer Wait/Idle", () => {
		assert.equal(resolveExecutionAuthority(true), "live");
		assert.equal(executionAuthorityBadge("live").labelDe, "LIVE");
		const agenda = buildUnifiedDayAgendaDe(
			emptyPlan(),
			{
				nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
				wallbox: { liveWriteAllowed: true, hardwareActive: false },
			},
			{
				schemaVersion: 1,
				generatedAtIso: "2026-08-08T14:00:00.000Z",
				battery: deriveBatteryStrategicStatus({
					plan: emptyPlan(),
					socPct: 40,
					minSocPct: 10,
					maxSocPct: 100,
					nightReserveKwh: null,
					usableCapacityKwh: 10,
					batteryHold: false,
					dischargeLiveSupported: false,
					nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
				}),
				wallbox: deriveWallboxStrategicStatus({
					plan: emptyPlan(),
					connectedNow: false,
					requiredEnergyKwh: null,
					deadlineIso: null,
					hasHardFuturePresence: false,
					nowMs: Date.parse("2026-08-08T14:00:00.000Z"),
				}),
			},
		);
		const wb = agenda.find((l) => /Wallbox/i.test(l)) ?? "";
		assert.match(wb, /^LIVE/);
		assert.match(wb, /Fahrzeug/i);
	});

	it("Execution-Gates unverändert", () => {
		assert.equal(isEffectiveLiveWriteAllowed("live", "live"), true);
		assert.equal(isEffectiveLiveWriteAllowed("live", "dryrun"), false);
		assert.equal(isEffectiveLiveWriteAllowed("dryrun", "live"), false);
		// Legacy Heizstab-Phase bei aktueller Allocation bleibt dryrun
		assert.equal(
			resolveExecutionDisplayPhase({
				currentPlannedActive: true,
				hasFuturePlan: false,
				liveWriteAllowed: false,
				hardwareActive: false,
			}),
			"dryrun",
		);
	});
});

describe("Beta-Befund 003 — Agenda Past verdrängt Zukunft nicht", () => {
	it("vergangene Fenster zählen nicht gegen Kontingent", () => {
		const nowMs = Date.parse("2026-08-08T14:00:00.000Z");
		const windows = [
			{
				startIso: "2026-08-08T08:00:00.000Z",
				endIso: "2026-08-08T09:00:00.000Z",
				energyKwh: 2,
			},
			{
				startIso: "2026-08-08T08:00:00.000Z",
				endIso: "2026-08-08T08:30:00.000Z",
				energyKwh: 1,
			},
			{
				startIso: "2026-08-08T16:00:00.000Z",
				endIso: "2026-08-08T17:00:00.000Z",
				energyKwh: 1.5,
			},
			{
				startIso: "2026-08-09T10:00:00.000Z",
				endIso: "2026-08-09T11:00:00.000Z",
				energyKwh: 2,
			},
		];
		const selected = selectRelevantAgendaWindows(windows, nowMs, "Europe/Berlin", { max: 2 });
		assert.equal(selected.length, 2);
		assert.equal(selected[0]!.startIso, "2026-08-08T16:00:00.000Z");
		assert.equal(selected[1]!.startIso, "2026-08-09T10:00:00.000Z");
	});

	it("Zukunft über Mitternacht / Goal-Deadline bleibt sichtbar", () => {
		const nowMs = Date.parse("2026-08-08T22:00:00.000Z");
		const windows = [
			{
				startIso: "2026-08-08T12:00:00.000Z",
				endIso: "2026-08-08T13:00:00.000Z",
				energyKwh: 1,
			},
			{
				startIso: "2026-08-09T06:00:00.000Z",
				endIso: "2026-08-09T07:00:00.000Z",
				energyKwh: 3,
			},
		];
		const selected = selectRelevantAgendaWindows(windows, nowMs, "Europe/Berlin", {
			max: 2,
			deadlineIso: "2026-08-09T08:00:00.000Z",
		});
		assert.ok(selected.some((w) => w.startIso.startsWith("2026-08-09")));
	});

	it("mergeWindows + select: Rest-heute vor Past", () => {
		const cells = [
			{
				slot: { startIso: "2026-08-08T06:00:00.000Z", endIso: "2026-08-08T06:15:00.000Z" },
				consumerId: "immersion_heater",
				kind: "immersion_heater" as const,
				allocatedPowerW: 1700,
				allocatedEnergyKwh: 0.425,
				energySource: "pv_surplus" as const,
				constraintIds: [],
				reasonCodes: [],
			},
			{
				slot: { startIso: "2026-08-08T15:00:00.000Z", endIso: "2026-08-08T15:15:00.000Z" },
				consumerId: "immersion_heater",
				kind: "immersion_heater" as const,
				allocatedPowerW: 1700,
				allocatedEnergyKwh: 0.425,
				energySource: "pv_surplus" as const,
				constraintIds: [],
				reasonCodes: [],
			},
		];
		const merged = mergeWindows(cells, "immersion_heater");
		const sel = selectRelevantAgendaWindows(
			merged,
			Date.parse("2026-08-08T14:00:00.000Z"),
			"Europe/Berlin",
			{ max: 2 },
		);
		assert.equal(sel.length, 1);
		assert.equal(sel[0]!.startIso, "2026-08-08T15:00:00.000Z");
	});
});
