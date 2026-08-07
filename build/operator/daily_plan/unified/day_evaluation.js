"use strict";
/**
 * Tagesbewertung (Struktur für späteres Learning) — noch keine Persistenz/DB.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDayEvaluationDraft = void 0;
function buildDayEvaluationDraft(input) {
    return {
        date: input.date,
        timezone: input.timezone,
        evaluatedAtIso: input.now.toISOString(),
        expectedPvKwh: input.expectedPvKwh,
        actualPvKwh: input.actualPvKwh,
        expectedHouseLoadKwh: input.expectedHouseLoadKwh,
        actualHouseLoadKwh: input.actualHouseLoadKwh,
        expectedGridImportKwh: input.expectedGridImportKwh,
        actualGridImportKwh: input.actualGridImportKwh,
        expectedGridExportKwh: input.expectedGridExportKwh,
        actualGridExportKwh: input.actualGridExportKwh,
        expectedImmersionKwh: input.expectedImmersionKwh,
        actualImmersionKwh: input.actualImmersionKwh,
        expectedClimateKwh: input.expectedClimateKwh,
        actualClimateKwh: input.actualClimateKwh,
        replanCount: input.replanCount,
        replanReasons: [...input.replanReasons],
        goalsMet: input.goalsMet.map((g) => ({ ...g })),
    };
}
exports.buildDayEvaluationDraft = buildDayEvaluationDraft;
