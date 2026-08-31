import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEconomicsDayRecord, sumEconomicsDays } from "./compute";
import type { ShadowDayRecord } from "../learning/shadow_engine/types";
import { notEvaluableStrategyResult } from "../learning/shadow_engine/types";

const NOW = new Date("2026-08-30T12:00:00.000Z");

function shadowFixture(overrides: Partial<ShadowDayRecord> = {}): ShadowDayRecord {
	return {
		module: "shadow_engine",
		schemaVersion: 1,
		dateKey: "2026-08-29",
		timezone: "Europe/Berlin",
		generatedAtIso: NOW.toISOString(),
		sourceTelemetryLastSampleIso: NOW.toISOString(),
		dayEvaluable: true,
		real: {
			gridImportKwh: 2,
			gridExportKwh: 3,
			batteryChargeKwh: 4,
			batteryDischargeKwh: 3,
			socStartPct: 90,
			socEndPct: 60,
			importCostEur: 0.6,
			exportCreditEur: 0.24,
			netCostEur: 0.36,
			slotCount: 96,
			observedSlotCount: 96,
			missingSlotCount: 0,
		},
		strategies: {
			reference_no_ems: {
				strategy: "reference_no_ems",
				modelVersion: "shadow_v1",
				evaluable: true,
				missingSlotCount: 0,
				assumptionsDe: ["x"],
				gridImportKwh: 5,
				gridExportKwh: 1,
				batteryChargeKwh: 2,
				batteryDischargeKwh: 1,
				socStartPct: 90,
				socEndPct: 70,
				importCostEur: 1.5,
				exportCreditEur: 0.08,
				netCostEur: 1.42,
			},
			ems_without_ai: {
				strategy: "ems_without_ai",
				modelVersion: "shadow_v1",
				evaluable: true,
				missingSlotCount: 0,
				assumptionsDe: ["y"],
				gridImportKwh: 2,
				gridExportKwh: 3,
				batteryChargeKwh: 4,
				batteryDischargeKwh: 3,
				socStartPct: 90,
				socEndPct: 60,
				importCostEur: 0.6,
				exportCreditEur: 0.24,
				netCostEur: 0.36,
			},
		},
		...overrides,
	};
}

describe("buildEconomicsDayRecord", () => {
	it("berechnet EMS-Vorteil und KI-Mehrwert aus Shadow-Netto-Kosten", () => {
		const rec = buildEconomicsDayRecord({
			dateKey: "2026-08-29",
			final: true,
			tarifvorteilEur: 0.5,
			gridRewardsCreditEur: 0.1,
			gridRewardsSource: "estimate_day",
			shadow: shadowFixture(),
			now: NOW,
		});
		assert.equal(rec.emsVorteilEur, 1.06); // 1.42 - 0.36
		assert.equal(rec.kiMehrwertEur, 0); // 0.36 - 0.36 (kein Live-KI-Einfluss)
		assert.equal(rec.tarifvorteilEur, 0.5);
		assert.equal(rec.emsVorteilEvaluable, true);
		assert.equal(rec.kiMehrwertEvaluable, true);
	});

	it("negativer KI-Mehrwert ist darstellbar (kein Schönrechnen)", () => {
		const shadow = shadowFixture({
			strategies: {
				reference_no_ems: notEvaluableStrategyResult("reference_no_ems", []),
				ems_without_ai: {
					strategy: "ems_without_ai",
					modelVersion: "shadow_v1",
					evaluable: true,
					missingSlotCount: 0,
					assumptionsDe: [],
					gridImportKwh: 1,
					gridExportKwh: 1,
					batteryChargeKwh: 1,
					batteryDischargeKwh: 1,
					socStartPct: 90,
					socEndPct: 80,
					importCostEur: 0.1,
					exportCreditEur: 0,
					netCostEur: 0.1,
				},
			},
			real: { ...shadowFixture().real, netCostEur: 0.5 },
		});
		const rec = buildEconomicsDayRecord({
			dateKey: "2026-08-29",
			final: true,
			tarifvorteilEur: null,
			gridRewardsCreditEur: null,
			gridRewardsSource: null,
			shadow,
			now: NOW,
		});
		assert.equal(rec.kiMehrwertEur, -0.4); // 0.1 - 0.5 < 0 → KI hat es schlechter gemacht
		assert.equal(rec.emsVorteilEvaluable, false);
		assert.equal(rec.emsVorteilEur, null);
	});

	it("liefert null statt erfundener Werte ohne Shadow-Daten", () => {
		const rec = buildEconomicsDayRecord({
			dateKey: "2026-08-30",
			final: false,
			tarifvorteilEur: 0.2,
			gridRewardsCreditEur: null,
			gridRewardsSource: null,
			shadow: null,
			now: NOW,
		});
		assert.equal(rec.emsVorteilEur, null);
		assert.equal(rec.kiMehrwertEur, null);
		assert.equal(rec.tarifvorteilEur, 0.2);
		assert.ok(rec.notesDe.length >= 2);
	});
});

describe("sumEconomicsDays", () => {
	it("summiert nur bewertbare Tage getrennt je Effekt", () => {
		const days = [
			buildEconomicsDayRecord({
				dateKey: "2026-08-28",
				final: true,
				tarifvorteilEur: 1,
				gridRewardsCreditEur: 0.5,
				gridRewardsSource: "estimate_day",
				shadow: shadowFixture(),
				now: NOW,
			}),
			buildEconomicsDayRecord({
				dateKey: "2026-08-29",
				final: false,
				tarifvorteilEur: null,
				gridRewardsCreditEur: null,
				gridRewardsSource: null,
				shadow: null,
				now: NOW,
			}),
		];
		const sum = sumEconomicsDays(days, {
			period: "test",
			periodLabelDe: "Test",
			fromKey: "2026-08-28",
			toKey: "2026-08-29",
		});
		assert.equal(sum.daysTotal, 2);
		assert.equal(sum.daysTarifvorteilEvaluable, 1);
		assert.equal(sum.tarifvorteilEur, 1);
		assert.equal(sum.daysEmsVorteilEvaluable, 1);
		assert.equal(sum.gridRewardsCreditEur, null);
	});

	it("zählt Schätzung 0 nicht als vorhandenen Reward, Abrechnung 0 schon", () => {
		const estimateZero = buildEconomicsDayRecord({
			dateKey: "2026-08-28",
			final: true,
			tarifvorteilEur: 1,
			gridRewardsCreditEur: 0,
			gridRewardsSource: "estimate_day",
			shadow: shadowFixture(),
			now: NOW,
		});
		const billingZero = buildEconomicsDayRecord({
			dateKey: "2026-08-29",
			final: true,
			tarifvorteilEur: 1,
			gridRewardsCreditEur: 0,
			gridRewardsSource: "billing",
			shadow: shadowFixture(),
			now: NOW,
		});
		const none = sumEconomicsDays([estimateZero], {
			period: "test",
			periodLabelDe: "Test",
			fromKey: "2026-08-28",
			toKey: "2026-08-28",
		});
		assert.equal(none.gridRewardsCreditEur, null);
		const billed = sumEconomicsDays([billingZero], {
			period: "test",
			periodLabelDe: "Test",
			fromKey: "2026-08-29",
			toKey: "2026-08-29",
		});
		assert.equal(billed.gridRewardsCreditEur, 0);
	});

	it("liefert null (nicht 0) wenn kein Tag bewertbar ist", () => {
		const sum = sumEconomicsDays([], { period: "x", periodLabelDe: "x", fromKey: "a", toKey: "b" });
		assert.equal(sum.tarifvorteilEur, null);
		assert.equal(sum.emsVorteilEur, null);
		assert.equal(sum.kiMehrwertEur, null);
	});
});
