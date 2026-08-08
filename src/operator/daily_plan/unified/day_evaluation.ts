/**
 * @deprecated Draft-Typ — produktive Persistenz: `src/learning/day_evaluation/`.
 * Bleibt für bestehende Replan-Tests kompatibel.
 */

export type UnifiedDayEvaluation = {
	date: string;
	timezone: string;
	evaluatedAtIso: string;
	expectedPvKwh: number | null;
	actualPvKwh: number | null;
	expectedHouseLoadKwh: number | null;
	actualHouseLoadKwh: number | null;
	expectedGridImportKwh: number | null;
	actualGridImportKwh: number | null;
	expectedGridExportKwh: number | null;
	actualGridExportKwh: number | null;
	expectedImmersionKwh: number | null;
	actualImmersionKwh: number | null;
	expectedClimateKwh: number | null;
	actualClimateKwh: number | null;
	replanCount: number;
	replanReasons: string[];
	goalsMet: Array<{ consumerId: string; goalId: string; met: boolean | null }>;
};

export function buildDayEvaluationDraft(input: {
	date: string;
	timezone: string;
	now: Date;
	expectedPvKwh: number | null;
	actualPvKwh: number | null;
	expectedHouseLoadKwh: number | null;
	actualHouseLoadKwh: number | null;
	expectedGridImportKwh: number | null;
	actualGridImportKwh: number | null;
	expectedGridExportKwh: number | null;
	actualGridExportKwh: number | null;
	expectedImmersionKwh: number | null;
	actualImmersionKwh: number | null;
	expectedClimateKwh: number | null;
	actualClimateKwh: number | null;
	replanCount: number;
	replanReasons: string[];
	goalsMet: Array<{ consumerId: string; goalId: string; met: boolean | null }>;
}): UnifiedDayEvaluation {
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
