/** Test-Fixtures für daily_evaluator — kein Produktionscode, nur von *.test.ts importiert. */
import { buildDaySlotLayout } from "../day_telemetry/slots";
import { emptyDayRecord, type DayTelemetryDayRecord, type PlannerKnowledgeSnapshot } from "../day_telemetry/types";
import type { EvaluatorFinding } from "./types";

export function freshDay(dateKey = "2026-06-15", tz = "Europe/Berlin"): DayTelemetryDayRecord {
	const layout = buildDaySlotLayout(dateKey, tz);
	return emptyDayRecord(dateKey, tz, layout.startMs, layout.endMs, layout.slotCount);
}

export function makeSnapshot(overrides: Partial<PlannerKnowledgeSnapshot> = {}): PlannerKnowledgeSnapshot {
	return {
		id: overrides.id ?? "snap-1",
		tsIso: overrides.tsIso ?? "2026-06-15T12:00:00.000Z",
		date: "2026-06-15",
		timezone: "Europe/Berlin",
		globalMode: "balanced",
		contributionRevision: 1,
		pvExpectedDayKwh: null,
		houseLoadExpectedDayKwh: null,
		batterySocPct: null,
		batteryCapacityKwh: null,
		batteryNightReserveKwh: null,
		priceSlots: [],
		pvSlotKwh: [],
		wallboxRequiredEnergyKwh: null,
		wallboxDeadlineIso: null,
		wallboxConnected: null,
		wallboxPresenceDigest: null,
		thermalBufferTempC: null,
		thermalEmptyAtIso: null,
		thermalHeadroomKwh: null,
		climateUnits: [],
		wallboxTargetSocPct: null,
		wallboxMinimumDepartureSocPct: null,
		wallboxEnergyGoalHard: null,
		wallboxManagementMode: null,
		batteryDecision: null,
		...overrides,
	};
}

let findingSeq = 0;

/** Baut ein minimales, gültiges EvaluatorFinding — für Score-/Learning-Tests, wo die
 * konkrete Domain-Findings-Logik nicht Teil des Testfokus ist. */
export function makeFinding(overrides: Partial<EvaluatorFinding> = {}): EvaluatorFinding {
	findingSeq += 1;
	return {
		id: overrides.id ?? `finding-${findingSeq}`,
		dateKey: overrides.dateKey ?? "2026-06-15",
		tsStartIso: overrides.tsStartIso ?? "2026-06-15T10:00:00.000Z",
		tsEndIso: overrides.tsEndIso ?? "2026-06-15T10:30:00.000Z",
		domain: overrides.domain ?? "battery",
		assetRef: overrides.assetRef ?? null,
		eventType: overrides.eventType ?? "battery_reserve_check",
		quality: overrides.quality ?? { decisionQuality: "reasonable", outcomeQuality: "reasonable" },
		confidence: overrides.confidence ?? 70,
		snapshotIdRef: overrides.snapshotIdRef ?? null,
		measurements: overrides.measurements ?? {},
		energyImpactKwh: overrides.energyImpactKwh ?? null,
		costImpactCt: overrides.costImpactCt ?? null,
		reasonCodes: overrides.reasonCodes ?? [],
		explanationDe: overrides.explanationDe ?? "Test-Finding.",
		insufficientData: overrides.insufficientData ?? false,
		notApplicable: overrides.notApplicable ?? false,
		userOverride: overrides.userOverride ?? false,
	};
}
