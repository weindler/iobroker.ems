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
/**
 * Abnahme-Korrektur #1: "besseres Fenster vor thermalEmptyAtIso". Ein reiner Vergleich gegen
 * die absoluten Block-A-Bucket-Grenzen (0.35/0.65/0.85 aus `classifyByPricePercentile`) wäre
 * hier redundant: ein Run gilt schon dann als "avoidable"/"wasteful", wenn sein eigenes
 * Preis-Perzentil > 0.65 liegt — unabhängig davon, ob später ein Fenster existierte. Die
 * Opportunity-Prüfung braucht daher einen RELATIVEN Mindestabstand zwischen Run-Perzentil und
 * Kandidaten-Perzentil, um "deutlich günstiger"/"sinnvoll mehr PV" von einem bloß leicht
 * besseren Fenster zu unterscheiden. Lokal begründeter Schwellwert: 0.30 — dieselbe
 * Größenordnung wie der breiteste bereits bestehende Bucket-Abstand (0.65−0.35=0.30) in
 * `classifyByPricePercentile`, keine neu erfundene Zahl auf einer anderen Skala. Wird unten in
 * dedizierten Tests abgedeckt.
 */
const SIGNIFICANT_PERCENTILE_GAP = 0.3;
const BETTER_WINDOW_REASON_CODE = "better_window_available_before_thermal_empty";
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
/**
 * Gab es zwischen Run-Start (exklusiv) und thermalEmptyAtIso (exklusiv) im DAMALS bekannten
 * Snapshot einen Preis-Slot, der um mindestens SIGNIFICANT_PERCENTILE_GAP günstiger war als der
 * Run selbst (auf derselben Perzentil-Skala wie `priceRankPercentileAtDecisionTime`)? Nutzt
 * ausschließlich snapshot.priceSlots (Forecast zum Entscheidungszeitpunkt) — nie reale spätere
 * Preise.
 */
function hasCheaperWindowBeforeEmpty(snapshot, runStartMs, thermalEmptyAtMs, currentPricePercentile) {
    if (currentPricePercentile == null)
        return false;
    for (const [startMs, ct] of snapshot.priceSlots) {
        if (!(startMs > runStartMs) || !(startMs < thermalEmptyAtMs))
            continue;
        const pct = (0, knowledge_time_1.priceRankPercentileAtDecisionTime)(snapshot, ct);
        if (pct != null && currentPricePercentile - pct >= SIGNIFICANT_PERCENTILE_GAP)
            return true;
    }
    return false;
}
/**
 * Gab es zwischen Run-Start (exklusiv) und thermalEmptyAtIso (exklusiv) im DAMALS bekannten
 * Snapshot einen PV-Slot mit um mindestens SIGNIFICANT_PERCENTILE_GAP mehr erwarteter PV als
 * der Run selbst (dieselbe Perzentil-Methode wie beim Preis, nur auf pvSlotKwh angewandt)?
 * Nutzt ausschließlich snapshot.pvSlotKwh (Forecast zum Entscheidungszeitpunkt) — nie reale PV.
 */
function hasMorePvWindowBeforeEmpty(snapshot, runStartMs, thermalEmptyAtMs, currentPvPercentile) {
    if (currentPvPercentile == null)
        return false;
    for (const [startMs, kwh] of snapshot.pvSlotKwh) {
        if (!(startMs > runStartMs) || !(startMs < thermalEmptyAtMs))
            continue;
        const pct = (0, knowledge_time_1.pvRankPercentileAtDecisionTime)(snapshot, kwh);
        if (pct != null && pct - currentPvPercentile >= SIGNIFICANT_PERCENTILE_GAP)
            return true;
    }
    return false;
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
            // Abnahme-Korrektur #1: Opportunity-Check gegen thermalEmptyAtIso — nur wenn Preis zum
            // Entscheidungszeitpunkt bekannt war und der Lauf nicht forciert ist (Forced schlägt
            // Opportunity-Bewertung). Wirkt ausschließlich auf decisionQuality — outcomeQuality bleibt
            // unverändert auf tatsächlichen Werten (siehe Modul-Kommentar).
            if (!insufficientData && seg.forcedMode !== true && snapshot?.thermalEmptyAtIso) {
                const thermalEmptyAtMs = Date.parse(snapshot.thermalEmptyAtIso);
                if (Number.isFinite(thermalEmptyAtMs) && thermalEmptyAtMs > seg.startTs) {
                    const currentPvKwh = slotStartMs != null ? (0, knowledge_time_1.resolveKnownPvAtSlotStart)(snapshot, slotStartMs) : null;
                    const currentPvPercentile = (0, knowledge_time_1.pvRankPercentileAtDecisionTime)(snapshot, currentPvKwh);
                    const cheaperLater = hasCheaperWindowBeforeEmpty(snapshot, seg.startTs, thermalEmptyAtMs, decisionPercentile);
                    const morePvLater = hasMorePvWindowBeforeEmpty(snapshot, seg.startTs, thermalEmptyAtMs, currentPvPercentile);
                    if (cheaperLater || morePvLater) {
                        reasonCodes.push(BETTER_WINDOW_REASON_CODE);
                        if (cheaperLater && (decisionQuality === "reasonable" || decisionQuality === "early")) {
                            decisionQuality = "avoidable";
                        }
                        else if (!cheaperLater && morePvLater && decisionQuality === "reasonable") {
                            decisionQuality = "early";
                        }
                    }
                }
            }
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
            explanationDe: buildExplanation(seg, decisionQuality, outcomeQuality, reasonCodes),
            insufficientData,
            notApplicable: false,
            userOverride: seg.forcedMode === true,
        });
    }
    return findings;
}
exports.evaluateThermalFindings = evaluateThermalFindings;
function buildExplanation(seg, decisionQuality, outcomeQuality, reasonCodes) {
    const runtimeMin = Math.round(seg.runtimeSec / 60);
    const base = `Heizstab-Lauf ${runtimeMin} min, ${seg.energyKwh.toFixed(2)} kWh`;
    if (decisionQuality === "mandatory")
        return `${base} — Hygiene-Pflicht fällig, Preis irrelevant.`;
    if (decisionQuality === "necessary")
        return `${base} — thermischer Sicherheits-Fallback.`;
    if (decisionQuality === "unknown")
        return `${base} — Entscheidungsquelle zum Laufzeitpunkt nicht verfügbar (insufficient_data).`;
    const opportunitySuffix = reasonCodes.includes(BETTER_WINDOW_REASON_CODE)
        ? " Laut damaligem Snapshot gab es vor thermalEmptyAtIso ein objektiv besseres PV-/Preisfenster."
        : "";
    return `${base} — Tagesplan-Lauf, decisionQuality=${decisionQuality}, outcomeQuality=${outcomeQuality}.${opportunitySuffix}`;
}
