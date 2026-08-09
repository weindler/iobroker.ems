import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	agendaStatusLabelDe,
	buildAgendaExecutionHints,
	executionDisplayBadge,
	formatAgendaSlotMetaDe,
	formatExecutionNowLineDe,
	isEffectiveLiveWriteAllowed,
	isImmersionHardwareActive,
	resolveClimateUnitDisplay,
	resolveExecutionDisplayPhase,
} from "./execution_display";
import { buildUnifiedDayAgendaDe } from "./product_summary";
import type { UnifiedDayPlan } from "../operator/daily_plan/unified/types";

describe("execution_display hierarchy", () => {
	it("only Global Live + Addon Live allows effective live writes", () => {
		assert.equal(isEffectiveLiveWriteAllowed("live", "live"), true);
		assert.equal(isEffectiveLiveWriteAllowed("live", "dryrun"), false);
		assert.equal(isEffectiveLiveWriteAllowed("dryrun", "live"), false);
		assert.equal(isEffectiveLiveWriteAllowed("dryrun", "dryrun"), false);
	});
});

describe("execution_display phases GEPLANT / DRYRUN / LÄUFT", () => {
	it("GEPLANT: future allocation, no current dryrun claim", () => {
		const phase = resolveExecutionDisplayPhase({
			currentPlannedActive: false,
			hasFuturePlan: true,
			liveWriteAllowed: false,
			hardwareActive: false,
		});
		assert.equal(phase, "planned");
		assert.equal(agendaStatusLabelDe(phase), "GEPLANT");
		assert.equal(executionDisplayBadge(phase).labelDe, "Geplant");
		assert.equal(executionDisplayBadge(phase).cls, "plan");
	});

	it("DRYRUN: Global Live + Addon Dryrun + current allocation — never LÄUFT", () => {
		assert.equal(isEffectiveLiveWriteAllowed("live", "dryrun"), false);
		const phase = resolveExecutionDisplayPhase({
			currentPlannedActive: true,
			hasFuturePlan: false,
			liveWriteAllowed: false,
			hardwareActive: false,
		});
		assert.equal(phase, "dryrun");
		assert.equal(agendaStatusLabelDe(phase), "DRYRUN");
		assert.equal(executionDisplayBadge(phase).cls, "dryrun");
		assert.equal(formatAgendaSlotMetaDe({ phase, plannerPowerW: 1700 }), "DRYRUN · geplant 1700 W");
		assert.equal(
			formatExecutionNowLineDe({
				phase,
				plannerPowerW: 1700,
				hardwareLabelDe: "unverändert",
			}),
			"Planner: 1700 W · Hardware: unverändert",
		);
	});

	it("DRYRUN: Global Dryrun + Addon Live + current allocation — never LÄUFT", () => {
		assert.equal(isEffectiveLiveWriteAllowed("dryrun", "live"), false);
		const phase = resolveExecutionDisplayPhase({
			currentPlannedActive: true,
			hasFuturePlan: true,
			liveWriteAllowed: false,
			hardwareActive: true, // Ist egal — ohne Live-Authority kein LÄUFT
		});
		assert.equal(phase, "dryrun");
		assert.notEqual(agendaStatusLabelDe(phase), "LÄUFT");
	});

	it("LÄUFT: only Global Live + Addon Live + hardware confirmed", () => {
		const phase = resolveExecutionDisplayPhase({
			currentPlannedActive: true,
			hasFuturePlan: false,
			liveWriteAllowed: true,
			hardwareActive: true,
		});
		assert.equal(phase, "running");
		assert.equal(agendaStatusLabelDe(phase), "LÄUFT");
		assert.equal(executionDisplayBadge(phase).cls, "on");
		assert.equal(
			formatExecutionNowLineDe({
				phase,
				plannerPowerW: 1700,
				hardwareLabelDe: "an · 1700 W",
			}),
			"an · 1700 W",
		);
	});

	it("allocated/commanded without live authority never becomes LÄUFT", () => {
		assert.equal(
			isImmersionHardwareActive({
				liveWriteAllowed: false,
				feedbackStage: 0,
				measuredPowerW: 0,
				commandedPowerW: 1700,
			}),
			false,
		);
		const phase = resolveExecutionDisplayPhase({
			currentPlannedActive: true,
			hasFuturePlan: false,
			liveWriteAllowed: false,
			hardwareActive: isImmersionHardwareActive({
				liveWriteAllowed: false,
				feedbackStage: 0,
				measuredPowerW: null,
				commandedPowerW: 1700,
			}),
		});
		assert.equal(phase, "dryrun");
	});

	it("live + feedback confirms hardware even if allocation already ended", () => {
		assert.equal(
			isImmersionHardwareActive({
				liveWriteAllowed: true,
				feedbackStage: 1,
				measuredPowerW: null,
				commandedPowerW: 0,
			}),
			true,
		);
		const phase = resolveExecutionDisplayPhase({
			currentPlannedActive: false,
			hasFuturePlan: false,
			liveWriteAllowed: true,
			hardwareActive: true,
		});
		assert.equal(phase, "running");
	});

	it("live + current plan without hardware → GEPLANT, not LÄUFT", () => {
		const phase = resolveExecutionDisplayPhase({
			currentPlannedActive: true,
			hasFuturePlan: false,
			liveWriteAllowed: true,
			hardwareActive: false,
		});
		assert.equal(phase, "planned");
		assert.equal(agendaStatusLabelDe(phase), "GEPLANT");
	});

	it("buildAgendaExecutionHints: Global Live + IH Dryrun → effective dryrun", () => {
		const hints = buildAgendaExecutionHints({
			globalMode: "live",
			addonModes: {
				immersion_heater: "dryrun",
				battery: "live",
				wallbox: "live",
				air_conditioning: "live",
			},
			hardware: {
				immersion: {
					feedbackStage: 0,
					measuredPowerW: 0,
					commandedPowerW: 1700,
					allocatedPowerW: 1700,
				},
			},
			nowMs: Date.parse("2026-08-04T12:00:00.000Z"),
		});
		assert.equal(hints.immersion_heater.liveWriteAllowed, false);
		assert.equal(hints.immersion_heater.hardwareActive, false);
		assert.equal(hints.immersion_heater.currentAllocatedW, 1700);
	});
});

describe("product_summary agenda execution labels", () => {
	function ihPlan(nowMs: number): UnifiedDayPlan {
		const start = new Date(nowMs - 5 * 60_000).toISOString();
		const end = new Date(nowMs + 10 * 60_000).toISOString();
		return {
			schemaVersion: 1,
			planId: "exec-agenda",
			generation: 1,
			inputRevision: 1,
			createdAtIso: new Date(nowMs).toISOString(),
			timezone: "Europe/Berlin",
			horizonStartIso: start,
			horizonEndIso: end,
			slotMinutes: 15,
			expectedPvEnergyTodayKwh: null,
			expectedHouseLoadEnergyTodayKwh: null,
			expectedPvEnergyToGoalKwh: null,
			expectedPvEnergyHorizonKwh: null,
			expectedHouseLoadEnergyHorizonKwh: null,
			expectedGridImportEnergyKwh: null,
			expectedGridExportEnergyKwh: null,
			expectedCostCt: null,
			batteryTrajectory: [],
			allocations: [
				{
					consumerId: "immersion_heater",
					kind: "immersion_heater",
					slot: { startIso: start, endIso: end },
					allocatedEnergyKwh: 0.4,
					allocatedPowerW: 1700,
					energySource: "pv_surplus",
					constraintIds: [],
					reasonCodes: [],
				},
			],
			goalStatuses: [],
			constraints: [],
			reasonCodes: [],
			confidence: { status: "valid", confidencePct: 80, reasonDe: "test" },
			vehicleChargeEconomics: null,
			totals: {
				pvForecastEnergyKwh: null,
				fixedHouseLoadEnergyKwh: null,
				fixedRenewableBalanceKwh: null,
				flexibleRequestedEnergyKwh: null,
				flexibleAllocatedEnergyKwh: 0.4,
				flexibleUnallocatedEnergyKwh: null,
				pvAllocatedEnergyKwh: 0.4,
				gridAllocatedEnergyKwh: 0,
				batteryChargeEnergyKwh: 0,
				wallboxEnergyKwh: 0,
				immersionHeaterEnergyKwh: 0.4,
				airConditioningEnergyKwh: 0,
				estimatedGridCostCt: null,
				mandatoryRequestedEnergyKwh: null,
				mandatoryAllocatedEnergyKwh: 0,
				mandatoryUnallocatedEnergyKwh: null,
			},
			legacyDailyPlan: null,
		};
	}

	it("current IH dryrun slot shows DRYRUN · geplant 1700 W, never LÄUFT", () => {
		const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
		const agenda = buildUnifiedDayAgendaDe(ihPlan(nowMs), {
			nowMs,
			immersion_heater: {
				liveWriteAllowed: false,
				hardwareActive: false,
				currentAllocatedW: 1700,
			},
		});
		const line = agenda.find((l) => /Heizstab/i.test(l)) ?? "";
		assert.match(line, /DRYRUN · geplant 1700 W/);
		assert.doesNotMatch(line, /LÄUFT/);
	});

	it("current IH live+hardware shows LÄUFT", () => {
		const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
		const agenda = buildUnifiedDayAgendaDe(ihPlan(nowMs), {
			nowMs,
			immersion_heater: {
				liveWriteAllowed: true,
				hardwareActive: true,
				currentAllocatedW: 1700,
			},
		});
		const line = agenda.find((l) => /Heizstab/i.test(l)) ?? "";
		assert.match(line, /LÄUFT/);
	});

	it("future-only without current active stays GEPLANT without LÄUFT/DRYRUN claim on idle", () => {
		const nowMs = Date.parse("2026-08-04T10:00:00.000Z");
		const start = new Date(nowMs + 2 * 3600_000).toISOString();
		const end = new Date(nowMs + 2.25 * 3600_000).toISOString();
		const plan = ihPlan(nowMs);
		plan.allocations = [
			{
				...plan.allocations[0]!,
				slot: { startIso: start, endIso: end },
			},
		];
		const agenda = buildUnifiedDayAgendaDe(plan, {
			nowMs,
			immersion_heater: {
				liveWriteAllowed: false,
				hardwareActive: false,
				currentAllocatedW: null,
			},
		});
		const line = agenda.find((l) => /Heizstab/i.test(l)) ?? "";
		assert.doesNotMatch(line, /LÄUFT/);
		assert.doesNotMatch(line, /^DRYRUN/);
	});
});

describe("climate unit display — Plan ≠ Bedarf ≠ Hardware", () => {
	it("hardware on + active demand → LÄUFT · Kühlbedarf aktiv", () => {
		const d = resolveClimateUnitDisplay({
			liveWriteAllowed: true,
			hardwareRunning: true,
			allocatedPowerW: 700,
			decisionSource: "daily_plan",
			reasonDe: "Läuft (Temp 26.0 °C ≥ 25.0 °C — cool). Daily Plan: 700 W freigegeben.",
			likelyActiveToday: true,
			expectedHoursToday: 2,
			expectedKwhToday: 1.4,
		});
		assert.equal(d.phase, "running");
		assert.equal(d.badge.labelDe, "Läuft");
		assert.equal(d.demand, "active");
		assert.equal(d.nowLineDe, "Läuft · Kühlbedarf aktiv");
		assert.equal(d.planLineDe, "Budget 700 W");
	});

	it("hardware on + no new demand (temperature_no_demand) → LÄUFT · Restlauf/Hysterese", () => {
		const d = resolveClimateUnitDisplay({
			liveWriteAllowed: true,
			hardwareRunning: true,
			allocatedPowerW: 700,
			decisionSource: "temperature_no_demand",
			reasonDe: "Daily Plan stellt 700 W bereit, aktuell kein Kühlbedarf.",
			likelyActiveToday: false,
		});
		assert.equal(d.phase, "running");
		assert.equal(d.badge.labelDe, "Läuft");
		assert.equal(d.demand, "hold");
		assert.match(d.nowLineDe, /Läuft · kein neuer Kühlbedarf, läuft wegen .+ weiter/);
		assert.doesNotMatch(d.nowLineDe, /^eingeschaltet$/);
		assert.equal(d.heuteLineDe, "Klima im Tagesplan");
		assert.equal(d.planLineDe, "Budget 700 W");
	});

	it("hardware on + explicit hysteresis reason → hold with Hysterese", () => {
		const d = resolveClimateUnitDisplay({
			liveWriteAllowed: true,
			hardwareRunning: true,
			allocatedPowerW: 700,
			decisionSource: "climate_fallback",
			reasonDe: "Temp 24.2 °C im Hysterese-Bereich — läuft weiter.",
		});
		assert.equal(d.demand, "hold");
		assert.match(d.nowLineDe, /wegen Hysterese weiter/);
	});

	it("hardware off + allocation + no demand → Bereit, not LÄUFT", () => {
		const d = resolveClimateUnitDisplay({
			liveWriteAllowed: true,
			hardwareRunning: false,
			allocatedPowerW: 700,
			decisionSource: "temperature_no_demand",
			reasonDe: "Daily Plan stellt 700 W bereit, aktuell kein Kühlbedarf.",
			likelyActiveToday: false,
		});
		assert.equal(d.phase, "planned");
		assert.equal(d.badge.labelDe, "Bereit");
		assert.equal(d.demand, "none");
		assert.equal(d.nowLineDe, "aktuell kein Kühlbedarf");
		assert.notEqual(d.badge.labelDe, "Läuft");
		assert.equal(d.planLineDe, "Budget 700 W");
	});

	it("dryrun + allocation never yields LÄUFT from planner alone", () => {
		const d = resolveClimateUnitDisplay({
			liveWriteAllowed: false,
			hardwareRunning: false,
			allocatedPowerW: 700,
			decisionSource: "temperature_no_demand",
			reasonDe: "Daily Plan stellt 700 W bereit, aktuell kein Kühlbedarf.",
		});
		assert.equal(d.phase, "dryrun");
		assert.equal(d.badge.cls, "dryrun");
		assert.notEqual(d.badge.labelDe, "Läuft");
		assert.match(d.nowLineDe, /Planner: 700 W/);
		assert.match(d.nowLineDe, /Hardware: aus/);
	});

	it("allocation is budget only — not automatic Kühlbedarf on Heute line", () => {
		const d = resolveClimateUnitDisplay({
			liveWriteAllowed: true,
			hardwareRunning: false,
			allocatedPowerW: 700,
			decisionSource: "temperature_no_demand",
			reasonDe: "Daily Plan stellt 700 W bereit, aktuell kein Kühlbedarf.",
			likelyActiveToday: false,
		});
		assert.equal(d.heuteLineDe, "Klima im Tagesplan");
		assert.equal(d.planLineDe, "Budget 700 W");
		assert.notEqual(d.heuteLineDe, d.planLineDe);
	});

	it("outside clock window + future plan → Gesperrt, not Aus; plan shows next window", () => {
		const d = resolveClimateUnitDisplay({
			liveWriteAllowed: true,
			hardwareRunning: false,
			allocatedPowerW: 0,
			decisionSource: "climate_fallback",
			reasonDe: "Außerhalb Zeitfenster 08:00–20:00.",
			likelyActiveToday: false,
			hasFuturePlan: true,
			nextPlanWindow: {
				startIso: "2026-08-09T09:00:00.000Z",
				endIso: "2026-08-09T11:00:00.000Z",
				startMs: Date.parse("2026-08-09T09:00:00.000Z"),
				endMs: Date.parse("2026-08-09T11:00:00.000Z"),
				powerW: 700,
				contributionId: "air_conditioning.unit_1",
			},
			timezone: "UTC",
		});
		assert.match(d.operationLabelDe, /Gesperrt/i);
		assert.match(d.operationLabelDe, /Zeitfenster/i);
		assert.notEqual(d.badge.labelDe, "Aus");
		assert.match(d.planLineDe, /nächstes/);
		assert.match(d.planLineDe, /700 W/);
		assert.equal(d.heuteLineDe, "Klima im Tagesplan");
	});

	it("outside clock window + no future plan → Gesperrt, wirklich kein Budget", () => {
		const d = resolveClimateUnitDisplay({
			liveWriteAllowed: true,
			hardwareRunning: false,
			allocatedPowerW: 0,
			reasonDe: "Außerhalb Zeitfenster 08:00–20:00.",
			likelyActiveToday: false,
			hasFuturePlan: false,
			nextPlanWindow: null,
		});
		assert.match(d.operationLabelDe, /Gesperrt/i);
		assert.equal(d.planLineDe, "kein Budget");
		assert.equal(d.heuteLineDe, "heute keine geplante Klimaaktion");
	});
});
