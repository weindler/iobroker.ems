"use strict";
/**
 * BLOCK A — Climate (Klima) Findings aus bestehenden ClimateRunSegment[] (Phase 1, kein
 * neues Telemetriefeld). Mandatory-Komfort kommt aus dem zum Laufzeitpunkt bekannten
 * Snapshot (climateUnits[].mandatory) — keine Rekonstruktion mit heutiger Admin-Config.
 * Kein Temperatur-/Komfort-Telemetrie verfügbar → Komfort-Klassifikation bleibt bewusst
 * auf Mandatory-Flag + Preis-Timing beschränkt, kein erfundener Komfort-Score.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateClimateFindings = void 0;
const slots_1 = require("../day_telemetry/slots");
const knowledge_time_1 = require("./knowledge_time");
// Abnahme-Korrektur #2: bereits vorhandene, fachlich begründete AC-Mindestlaufzeit-Konstante
// wiederverwenden (Referenz-Wert bei neutralem Komfortbedarf, siehe hard_off_worth_it.ts) —
// keine neue Komfortformel. Der Urgency-adjustierte Anteil (demandUrgency01) ist zum
// Snapshot-Zeitpunkt nicht historisiert (nur AC-Engine-intern) und wird daher NICHT genutzt;
// 20 Minuten ist die Obergrenze der bestehenden Regel (worst case bei Urgency=0).
const hard_off_worth_it_1 = require("../../addons/air_conditioning/runtime/hard_off_worth_it");
const LATE_START_REASON_CODE = "late_start_near_hard_off";
const HARD_OFF_CONTEXT_UNKNOWN_REASON_CODE = "hard_off_context_unknown";
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
            if (remainingMinutesUntilHardOff != null &&
                remainingMinutesUntilHardOff >= 0 &&
                remainingMinutesUntilHardOff < hard_off_worth_it_1.AC_MIN_WORTHWHILE_RUNTIME_MIN_DEFAULT) {
                // Start mit weniger Restzeit als die bestehende, bereits produktiv genutzte
                // Referenz-Mindestlaufzeit (neutraler Komfortbedarf) — belastbar aus historisiertem
                // hardStopMs ableitbar, ohne Urgency-Wert konservativ (Worst-Case) bewertet.
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
            },
            energyImpactKwh: seg.energyKwh,
            costImpactCt: actualPriceCtPerKwh != null ? Math.round(seg.energyKwh * actualPriceCtPerKwh * 100) / 100 : null,
            reasonCodes,
            explanationDe: buildClimateExplanation(seg, decisionQuality, reasonCodes, remainingMinutesUntilHardOff),
            insufficientData,
            notApplicable: false,
            userOverride: false,
        });
    }
    return findings;
}
exports.evaluateClimateFindings = evaluateClimateFindings;
function buildClimateExplanation(seg, decisionQuality, reasonCodes, remainingMinutesUntilHardOff) {
    const base = `Klima-Lauf (${seg.mode}, ${seg.activeUnitCombination}) ${Math.round(seg.runtimeSec / 60)} min, ${seg.energyKwh.toFixed(2)} kWh`;
    if (reasonCodes.includes(HARD_OFF_CONTEXT_UNKNOWN_REASON_CODE)) {
        return `${base} — historischer Hard-Off-Kontext zum Entscheidungszeitpunkt nicht persistiert (insufficient_data).`;
    }
    if (reasonCodes.includes(LATE_START_REASON_CODE)) {
        return `${base} — Start ${Math.round(remainingMinutesUntilHardOff ?? 0)} min vor Hard-Off, unter Referenz-Mindestlaufzeit (${hard_off_worth_it_1.AC_MIN_WORTHWHILE_RUNTIME_MIN_DEFAULT} min bei neutralem Komfortbedarf).`;
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
