"use strict";
/**
 * BLOCK A — Climate (Klima) Findings aus bestehenden ClimateRunSegment[] (Phase 1, kein
 * neues Telemetriefeld). Mandatory-Komfort kommt aus dem zum Laufzeitpunkt bekannten
 * Snapshot (climateUnits[].mandatory) — keine Rekonstruktion mit heutiger Admin-Config.
 * Kein Temperatur-/Komfort-Telemetrie verfügbar → Komfort-Klassifikation bleibt bewusst
 * auf Mandatory-Flag + Preis-Timing beschränkt, kein erfundener Komfort-Score.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateClimatePredictiveDayFindings = exports.evaluateClimateFindings = void 0;
const slots_1 = require("../day_telemetry/slots");
const knowledge_time_1 = require("./knowledge_time");
// Abnahme-Korrektur #2b: dieselbe fachliche Funktion wie die Runtime (`isHardOffStartWorthwhile`)
// mit den zum Entscheidungszeitpunkt tatsächlich bekannten Rohgrößen — keine neue Komfortformel,
// keine pauschale Urgency=0-Annahme. Die Urgency wird aus historisierten roomTempC/targetTempC
// (cool) bzw. roomHumidityPct/maxHumidityPct (dry) über dieselben Formeln nachgerechnet, die die
// Engine live nutzt (coolingDemandUrgency01/dehumidifyDemandUrgency01); der tatsächliche
// FSM-Modus (`seg.mode`, real historisiert) entscheidet, welche Formel greift.
const hard_off_worth_it_1 = require("../../addons/air_conditioning/runtime/hard_off_worth_it");
const LATE_START_REASON_CODE = "late_start_near_hard_off";
const HARD_OFF_CONTEXT_UNKNOWN_REASON_CODE = "hard_off_context_unknown";
const HARD_OFF_URGENCY_UNKNOWN_REASON_CODE = "hard_off_urgency_context_unknown";
/**
 * Rekonstruiert `demandUrgency01` aus den zum Entscheidungszeitpunkt historisierten Rohgrößen —
 * dieselben Formeln wie die FSM (fsm.ts), gesteuert vom real beobachteten `seg.mode`
 * ("cooling"/"dehumidify", 1:1 aus dem Runtime-State zum Laufzeitpunkt). `null` = Rohgrößen
 * fehlen oder Modus nicht eindeutig zuordenbar → nicht raten.
 */
function resolveHistoricalDemandUrgency01(seg, unitSnap) {
    if (!unitSnap)
        return null;
    if (seg.mode === "cooling") {
        if (unitSnap.roomTempC == null || unitSnap.targetTempC == null)
            return null;
        return (0, hard_off_worth_it_1.coolingDemandUrgency01)(unitSnap.roomTempC, unitSnap.targetTempC);
    }
    if (seg.mode === "dehumidify") {
        if (unitSnap.roomHumidityPct == null || unitSnap.maxHumidityPct == null)
            return null;
        return (0, hard_off_worth_it_1.dehumidifyDemandUrgency01)(unitSnap.roomHumidityPct, unitSnap.maxHumidityPct);
    }
    return null;
}
function actualPriceRankPercentile(day, priceCtPerKwh) {
    if (priceCtPerKwh == null || !Number.isFinite(priceCtPerKwh))
        return null;
    const values = day.buckets.priceCtPerKwh.filter((v) => v != null && Number.isFinite(v));
    if (values.length < 4)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    let below = 0;
    for (const v of sorted)
        if (v < priceCtPerKwh)
            below++;
    return below / sorted.length;
}
function classifyByPricePercentile(percentile) {
    if (percentile == null)
        return "unknown";
    if (percentile <= 0.35)
        return "reasonable";
    if (percentile <= 0.65)
        return "reasonable";
    if (percentile <= 0.85)
        return "avoidable";
    return "wasteful";
}
function evaluateClimateFindings(day) {
    const findings = [];
    const layout = (0, slots_1.buildDaySlotLayout)(day.dateKey, day.timezone);
    for (const seg of day.climateRunSegments) {
        if (!(seg.runtimeSec > 0))
            continue;
        if (!seg.valid) {
            findings.push(invalidFinding(day, seg));
            continue;
        }
        const slotIdx = (0, slots_1.slotIndexForMs)(layout, seg.startTs);
        const slotStartMs = slotIdx != null ? layout.slots[slotIdx].startMs : null;
        const actualPriceCtPerKwh = slotIdx != null ? day.buckets.priceCtPerKwh[slotIdx] : null;
        const snapshot = (0, knowledge_time_1.resolveKnowledgeSnapshotAt)(day, seg.startTs);
        const mandatory = snapshot?.climateUnits.some((u) => u.sharedPowerGroupId === seg.sharedPowerGroupId && u.mandatory === true) ?? false;
        const decisionPriceCtPerKwh = slotStartMs != null ? (0, knowledge_time_1.resolveKnownPriceAtSlotStart)(snapshot, slotStartMs) : null;
        const decisionPercentile = (0, knowledge_time_1.priceRankPercentileAtDecisionTime)(snapshot, decisionPriceCtPerKwh);
        const actualPercentile = actualPriceRankPercentile(day, actualPriceCtPerKwh);
        let decisionQuality;
        let outcomeQuality;
        const reasonCodes = [];
        let insufficientData = false;
        let demandUrgency01Resolved = null;
        // Abnahme-Korrektur #2: historischer Hard-Off-Kontext dieser Unit zum Entscheidungszeitpunkt
        // (nie aktuelle Config) — additiv aus climateUnits[].hardOffAtIso.
        const unitSnap = snapshot?.climateUnits.find((u) => u.sharedPowerGroupId === seg.sharedPowerGroupId) ?? null;
        const hardOffAtMs = unitSnap?.hardOffAtIso ? Date.parse(unitSnap.hardOffAtIso) : null;
        const remainingMinutesUntilHardOff = hardOffAtMs != null && Number.isFinite(hardOffAtMs) ? (hardOffAtMs - seg.startTs) / 60_000 : null;
        if (mandatory) {
            decisionQuality = "mandatory";
            outcomeQuality = "mandatory";
            reasonCodes.push("mandatory_comfort");
        }
        else if (!snapshot) {
            decisionQuality = "unknown";
            outcomeQuality = "unknown";
            reasonCodes.push("no_knowledge_snapshot");
            insufficientData = true;
        }
        else if (!unitSnap?.hardOffAtIso) {
            // Hard-Off-Kontext zum Entscheidungszeitpunkt nicht persistiert — nicht raten, ob
            // Start zu spät war; insufficient_data statt Rückfall auf reine Preis-Klassifikation.
            decisionQuality = "unknown";
            outcomeQuality = "unknown";
            reasonCodes.push(HARD_OFF_CONTEXT_UNKNOWN_REASON_CODE);
            insufficientData = true;
        }
        else {
            const demandUrgency01 = resolveHistoricalDemandUrgency01(seg, unitSnap);
            demandUrgency01Resolved = demandUrgency01;
            const urgencyMattersHere = remainingMinutesUntilHardOff != null &&
                remainingMinutesUntilHardOff >= 0 &&
                remainingMinutesUntilHardOff < hard_off_worth_it_1.AC_MIN_WORTHWHILE_RUNTIME_MIN_DEFAULT;
            if (urgencyMattersHere && demandUrgency01 == null) {
                // Restzeit liegt in der Zone, in der die Dringlichkeit das Ergebnis ändern könnte
                // (siehe isHardOffStartWorthwhile), aber die zum Entscheidungszeitpunkt bekannten
                // Rohgrößen (roomTempC/targetTempC bzw. roomHumidityPct/maxHumidityPct) fehlen im
                // Snapshot (nicht persistiert oder Alt-Daten vor dieser Erweiterung) — nicht raten.
                decisionQuality = "unknown";
                outcomeQuality = "unknown";
                reasonCodes.push(HARD_OFF_URGENCY_UNKNOWN_REASON_CODE);
                insufficientData = true;
            }
            else {
                // demandUrgency01 unbekannt außerhalb der Zone: wirkungslos für das Ergebnis
                // (requiredMinutes <= AC_MIN_WORTHWHILE_RUNTIME_MIN_DEFAULT <= remaining), daher
                // 0 (Worst-Case) unschädlich als Platzhalter — dieselbe Funktion wie die Runtime.
                const worthIt = (0, hard_off_worth_it_1.isHardOffStartWorthwhile)({
                    remainingMinutesUntilHardOff,
                    demandUrgency01: demandUrgency01 ?? 0,
                });
                if (!worthIt.worthwhile) {
                    decisionQuality = "avoidable";
                    outcomeQuality = "avoidable";
                    reasonCodes.push(LATE_START_REASON_CODE);
                }
                else {
                    decisionQuality = classifyByPricePercentile(decisionPercentile);
                    outcomeQuality = classifyByPricePercentile(actualPercentile);
                    reasonCodes.push(decisionPercentile == null ? "decision_price_unknown" : "price_timed");
                    insufficientData = decisionPercentile == null;
                }
            }
        }
        findings.push({
            id: `climate-${day.dateKey}-${seg.startTs}-${seg.sharedPowerGroupId ?? "unknown"}`,
            dateKey: day.dateKey,
            tsStartIso: new Date(seg.startTs).toISOString(),
            tsEndIso: new Date(seg.endTs).toISOString(),
            domain: "climate",
            assetRef: seg.sharedPowerGroupId,
            eventType: "climate_run",
            quality: { decisionQuality, outcomeQuality },
            confidence: insufficientData ? null : 65,
            snapshotIdRef: snapshot?.id ?? null,
            measurements: {
                energyKwh: seg.energyKwh,
                runtimeSec: seg.runtimeSec,
                decisionPriceCtPerKwh,
                actualPriceCtPerKwh,
                decisionPricePercentile: decisionPercentile,
                actualPricePercentile: actualPercentile,
                remainingMinutesUntilHardOff,
                demandUrgency01: demandUrgency01Resolved,
            },
            energyImpactKwh: seg.energyKwh,
            costImpactCt: actualPriceCtPerKwh != null ? Math.round(seg.energyKwh * actualPriceCtPerKwh * 100) / 100 : null,
            reasonCodes,
            explanationDe: buildClimateExplanation(seg, decisionQuality, reasonCodes, remainingMinutesUntilHardOff, demandUrgency01Resolved),
            insufficientData,
            notApplicable: false,
            userOverride: false,
        });
    }
    return findings;
}
exports.evaluateClimateFindings = evaluateClimateFindings;
/**
 * Additiv: predicted vs. actual Climate-Bedarf aus Snapshots.
 * Keine Selbstkorrektur, keine Änderung bestehender climate_run-Findings.
 */
function evaluateClimatePredictiveDayFindings(day) {
    const snaps = day.forecastSnapshots.filter((s) => s.climateUnits.some((u) => u.demandModel != null && u.demandModel !== ""));
    if (snaps.length === 0)
        return [];
    const first = snaps[0];
    const findings = [];
    for (const unit of first.climateUnits) {
        if (!unit.demandModel)
            continue;
        const plannedKwh = unit.expectedEnergyKwh ?? 0;
        const plannedH = unit.expectedRuntimeH ?? null;
        const unitIdx = Number((/unit_(\d+)/.exec(unit.consumerId) ?? [])[1]);
        let comfortViolated = false;
        for (const slots of day.buckets.climateUnitSlots ?? []) {
            if (!slots)
                continue;
            for (const s of slots) {
                if (Number.isFinite(unitIdx) && s.unitIndex !== unitIdx)
                    continue;
                if (s.roomTempC != null &&
                    s.coolingOnTempC != null &&
                    s.roomTempC >= s.coolingOnTempC) {
                    comfortViolated = true;
                }
                if (s.roomHumidityPct != null &&
                    s.maxHumidityPct != null &&
                    s.roomHumidityPct >= s.maxHumidityPct) {
                    comfortViolated = true;
                }
            }
        }
        let actualRuntimeSec = 0;
        for (const seg of day.climateRunSegments ?? []) {
            if (seg.valid && seg.runtimeSec > 0)
                actualRuntimeSec += seg.runtimeSec;
        }
        let classification = "unknown";
        let reason = "climate_predictive_day";
        if (plannedKwh > 0.2 && actualRuntimeSec < 300 && !comfortViolated) {
            classification = "avoidable";
            reason = "climate_planned_without_need";
        }
        else if (plannedKwh <= 0.05 && comfortViolated && actualRuntimeSec > 600) {
            classification = "necessary";
            reason = "climate_runtime_caught_underplan";
        }
        else if (plannedKwh > 0 && actualRuntimeSec > 0) {
            classification = "reasonable";
            reason = "climate_plan_and_runtime";
        }
        findings.push({
            id: `climate-predictive-${day.dateKey}-${unit.consumerId}`,
            dateKey: day.dateKey,
            tsStartIso: first.tsIso,
            tsEndIso: new Date(day.endMs).toISOString(),
            domain: "climate",
            assetRef: unit.consumerId,
            eventType: "climate_predictive_day",
            quality: { decisionQuality: classification, outcomeQuality: classification },
            confidence: unit.predictiveConfidence ?? null,
            snapshotIdRef: first.id,
            measurements: {
                plannedKwh,
                plannedHours: plannedH,
                actualRuntimeSec,
            },
            energyImpactKwh: null,
            costImpactCt: null,
            reasonCodes: [reason, `demand_model_${unit.demandModel}`],
            explanationDe: unit.fallbackReasonDe ||
                `Climate demand_model=${unit.demandModel}: geplant ${plannedKwh.toFixed(2)} kWh, Runtime ${Math.round(actualRuntimeSec / 60)} min.`,
            insufficientData: classification === "unknown",
            notApplicable: false,
            userOverride: false,
        });
    }
    return findings;
}
exports.evaluateClimatePredictiveDayFindings = evaluateClimatePredictiveDayFindings;
function buildClimateExplanation(seg, decisionQuality, reasonCodes, remainingMinutesUntilHardOff, demandUrgency01) {
    const base = `Klima-Lauf (${seg.mode}, ${seg.activeUnitCombination}) ${Math.round(seg.runtimeSec / 60)} min, ${seg.energyKwh.toFixed(2)} kWh`;
    if (reasonCodes.includes(HARD_OFF_CONTEXT_UNKNOWN_REASON_CODE)) {
        return `${base} — historischer Hard-Off-Kontext zum Entscheidungszeitpunkt nicht persistiert (insufficient_data).`;
    }
    if (reasonCodes.includes(HARD_OFF_URGENCY_UNKNOWN_REASON_CODE)) {
        return `${base} — Restzeit ${Math.round(remainingMinutesUntilHardOff ?? 0)} min vor Hard-Off, aber historischer Komfortbedarf (roomTemp/roomHumidity zum Entscheidungszeitpunkt) nicht persistiert (insufficient_data).`;
    }
    if (reasonCodes.includes(LATE_START_REASON_CODE)) {
        const urgencyPct = demandUrgency01 != null ? Math.round(demandUrgency01 * 100) : 0;
        return `${base} — Start ${Math.round(remainingMinutesUntilHardOff ?? 0)} min vor Hard-Off, bei damaligem Komfortbedarf (${urgencyPct} %) unter Mindestlaufzeit laut isHardOffStartWorthwhile.`;
    }
    return `${base} — decisionQuality=${decisionQuality}.`;
}
function invalidFinding(day, seg) {
    return {
        id: `climate-${day.dateKey}-${seg.startTs}-invalid`,
        dateKey: day.dateKey,
        tsStartIso: new Date(seg.startTs).toISOString(),
        tsEndIso: new Date(seg.endTs).toISOString(),
        domain: "climate",
        assetRef: seg.sharedPowerGroupId,
        eventType: "climate_run",
        quality: { decisionQuality: "unknown", outcomeQuality: "unknown" },
        confidence: null,
        snapshotIdRef: null,
        measurements: { energyKwh: seg.energyKwh, runtimeSec: seg.runtimeSec },
        energyImpactKwh: null,
        costImpactCt: null,
        reasonCodes: [seg.rejectReason ?? "invalid_segment"],
        explanationDe: `Klima-Segment ungültig (${seg.rejectReason ?? "unbekannt"}) — Energie/Preis-Zuordnung nicht belastbar.`,
        insufficientData: true,
        notApplicable: false,
        userOverride: false,
    };
}
