"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeFinding = exports.makeSnapshot = exports.freshDay = void 0;
/** Test-Fixtures für daily_evaluator — kein Produktionscode, nur von *.test.ts importiert. */
const slots_1 = require("../day_telemetry/slots");
const types_1 = require("../day_telemetry/types");
function freshDay(dateKey = "2026-06-15", tz = "Europe/Berlin") {
    const layout = (0, slots_1.buildDaySlotLayout)(dateKey, tz);
    return (0, types_1.emptyDayRecord)(dateKey, tz, layout.startMs, layout.endMs, layout.slotCount);
}
exports.freshDay = freshDay;
function makeSnapshot(overrides = {}) {
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
exports.makeSnapshot = makeSnapshot;
let findingSeq = 0;
/** Baut ein minimales, gültiges EvaluatorFinding — für Score-/Learning-Tests, wo die
 * konkrete Domain-Findings-Logik nicht Teil des Testfokus ist. */
function makeFinding(overrides = {}) {
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
exports.makeFinding = makeFinding;
