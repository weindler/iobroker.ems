"use strict";
/**
 * BLOCK A — Thermal (Heizstab) Findings aus echten immersionRunSegments (additive
 * Telemetrie-Erweiterung). Kontext-Felder (decisionSource/forcedMode/hygieneStatusDe/
 * ownershipOwner) sind Live-Mirror bereits vorhandener Runtime-States zum Laufzeitpunkt —
 * keine Rekonstruktion mit heutigem State. Preis-Einordnung ausschließlich relativ zur
 * zum Entscheidungszeitpunkt bekannten (decisionQuality) bzw. tatsächlichen (outcomeQuality)
 * Preisverteilung des Tages — nie ein fester Cent-Schwellwert.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateThermalFindings = void 0;
const slots_1 = require("../day_telemetry/slots");
const knowledge_time_1 = require("./knowledge_time");
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
function isHygieneDue(hygieneStatusDe) {
    if (!hygieneStatusDe)
        return false;
    return hygieneStatusDe.toLowerCase().includes("fällig");
}
function evaluateThermalFindings(day) {
    const findings = [];
    const layout = (0, slots_1.buildDaySlotLayout)(day.dateKey, day.timezone);
    for (const seg of day.immersionRunSegments) {
        if (!(seg.runtimeSec > 0))
            continue;
        const slotIdx = (0, slots_1.slotIndexForMs)(layout, seg.startTs);
        const slotStartMs = slotIdx != null ? layout.slots[slotIdx].startMs : null;
        const actualPriceCtPerKwh = slotIdx != null ? day.buckets.priceCtPerKwh[slotIdx] : null;
        const snapshot = (0, knowledge_time_1.resolveKnowledgeSnapshotAt)(day, seg.startTs);
        const decisionPriceCtPerKwh = slotStartMs != null ? (0, knowledge_time_1.resolveKnownPriceAtSlotStart)(snapshot, slotStartMs) : null;
        const decisionPercentile = (0, knowledge_time_1.priceRankPercentileAtDecisionTime)(snapshot, decisionPriceCtPerKwh);
        const actualPercentile = actualPriceRankPercentile(day, actualPriceCtPerKwh);
        let decisionQuality;
        let outcomeQuality;
        const reasonCodes = [];
        let insufficientData = false;
        if (isHygieneDue(seg.hygieneStatusDe)) {
            decisionQuality = "mandatory";
            outcomeQuality = "mandatory";
            reasonCodes.push("hygiene_duty");
        }
        else if (seg.decisionSource === "thermal_fallback" || seg.decisionSource === "safety") {
            decisionQuality = "necessary";
            outcomeQuality = "necessary";
            reasonCodes.push("thermal_safety_fallback");
        }
        else if (seg.decisionSource === "daily_plan") {
            decisionQuality = classifyByPricePercentile(decisionPercentile);
            outcomeQuality = classifyByPricePercentile(actualPercentile);
            reasonCodes.push(decisionPercentile == null ? "decision_price_unknown" : "daily_plan_price_timed");
            insufficientData = decisionPercentile == null;
        }
        else {
            decisionQuality = "unknown";
            outcomeQuality = "unknown";
            reasonCodes.push(seg.decisionSource ? `decision_source_${seg.decisionSource}` : "decision_source_unavailable");
            insufficientData = true;
        }
        if (seg.forcedMode === true) {
            reasonCodes.push("forced_mode_active");
        }
        findings.push({
            id: `thermal-${day.dateKey}-${seg.startTs}`,
            dateKey: day.dateKey,
            tsStartIso: new Date(seg.startTs).toISOString(),
            tsEndIso: new Date(seg.endTs).toISOString(),
            domain: "thermal",
            assetRef: "immersion_heater",
            eventType: "immersion_run",
            quality: { decisionQuality, outcomeQuality },
            confidence: insufficientData ? null : 70,
            snapshotIdRef: snapshot?.id ?? null,
            measurements: {
                energyKwh: seg.energyKwh,
                runtimeSec: seg.runtimeSec,
                decisionPriceCtPerKwh,
                actualPriceCtPerKwh,
                decisionPricePercentile: decisionPercentile,
                actualPricePercentile: actualPercentile,
            },
            energyImpactKwh: seg.energyKwh,
            costImpactCt: actualPriceCtPerKwh != null ? Math.round(seg.energyKwh * actualPriceCtPerKwh * 100) / 100 : null,
            reasonCodes,
            explanationDe: buildExplanation(seg, decisionQuality, outcomeQuality),
            insufficientData,
            notApplicable: false,
            userOverride: seg.forcedMode === true,
        });
    }
    return findings;
}
exports.evaluateThermalFindings = evaluateThermalFindings;
function buildExplanation(seg, decisionQuality, outcomeQuality) {
    const runtimeMin = Math.round(seg.runtimeSec / 60);
    const base = `Heizstab-Lauf ${runtimeMin} min, ${seg.energyKwh.toFixed(2)} kWh`;
    if (decisionQuality === "mandatory")
        return `${base} — Hygiene-Pflicht fällig, Preis irrelevant.`;
    if (decisionQuality === "necessary")
        return `${base} — thermischer Sicherheits-Fallback.`;
    if (decisionQuality === "unknown")
        return `${base} — Entscheidungsquelle zum Laufzeitpunkt nicht verfügbar (insufficient_data).`;
    return `${base} — Tagesplan-Lauf, decisionQuality=${decisionQuality}, outcomeQuality=${outcomeQuality}.`;
}
