"use strict";
/**
 * BLOCK A — Battery Findings.
 *
 * Bewusst NICHT implementiert (siehe Nutzer-Korrektur #5):
 * - `lost_pv_uptake_high_soc` (Ladefähigkeit/Authority zum Zeitpunkt nicht belastbar bekannt).
 * - Attribution "Heizstab/Klima lief aus Batterie", weil Discharge zeitgleich lief
 *   (Koinzidenz ≠ Kausalität — die Buckets trennen Quelle nicht).
 * - Jede Aussage über GRUND einer Entladung (Self-Consumption vs. Grid-Balance vs.
 *   Consumer-Allocation lassen sich aus batteryDischargedKwh alleine nicht unterscheiden).
 *
 * Einzige Battery-Finding in v1: Reserve-Treffgenauigkeit — Vergleich des zuletzt bekannten
 * `requiredSocAtPvEndPct` (additive Snapshot-Erweiterung, aus dem realen Discharge-Authority-
 * Decision-Pfad) gegen den tatsächlichen SOC-Tiefpunkt im Fenster danach (ggf. über
 * Mitternacht in den Folgetag hinein, falls dessen Telemetrie bereits vorliegt).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateBatteryFindings = void 0;
const slots_1 = require("../day_telemetry/slots");
const RESERVE_CHECK_WINDOW_MS = 18 * 3600_000;
function minSocInWindow(day, fromMs, toMs) {
    const layout = (0, slots_1.buildDaySlotLayout)(day.dateKey, day.timezone);
    let min = null;
    let covered = 0;
    let total = 0;
    for (const slot of layout.slots) {
        if (slot.endMs <= fromMs || slot.startMs >= toMs)
            continue;
        total++;
        const v = day.buckets.batterySocEndPct[slot.index];
        if (v != null && Number.isFinite(v)) {
            covered++;
            if (min == null || v < min)
                min = v;
        }
    }
    return { min, coveredSlots: covered, totalSlots: total };
}
/**
 * @param day Zu bewertender Tag.
 * @param nextDay Folgetag (falls dessen Telemetrie bereits vorliegt) — nur lesend für das
 *   Überlauf-Fenster nach Mitternacht, keine Rekonstruktion, nur reale Ist-Werte.
 */
function evaluateBatteryFindings(day, nextDay) {
    const findings = [];
    let bestSnap = null;
    let bestMs = -Infinity;
    for (const s of day.forecastSnapshots) {
        if (s.batteryDecision?.requiredSocAtPvEndPct == null)
            continue;
        const ms = Date.parse(s.tsIso);
        if (!Number.isFinite(ms))
            continue;
        if (ms > bestMs) {
            bestMs = ms;
            bestSnap = s;
        }
    }
    if (!bestSnap || bestSnap.batteryDecision?.requiredSocAtPvEndPct == null) {
        return findings;
    }
    const requiredPct = bestSnap.batteryDecision.requiredSocAtPvEndPct;
    const fromMs = bestMs;
    const toMs = fromMs + RESERVE_CHECK_WINDOW_MS;
    const todayWindow = minSocInWindow(day, fromMs, toMs);
    let min = todayWindow.min;
    let covered = todayWindow.coveredSlots;
    let total = todayWindow.totalSlots;
    if (nextDay && toMs > day.endMs) {
        const nextWindow = minSocInWindow(nextDay, fromMs, toMs);
        if (nextWindow.min != null && (min == null || nextWindow.min < min))
            min = nextWindow.min;
        covered += nextWindow.coveredSlots;
        total += nextWindow.totalSlots;
    }
    const coveragePct = total > 0 ? (covered / total) * 100 : 0;
    const insufficientData = min == null || coveragePct < 60;
    const tsEndIso = new Date(toMs).toISOString();
    if (insufficientData) {
        findings.push({
            id: `battery-reserve-${day.dateKey}-${fromMs}`,
            dateKey: day.dateKey,
            tsStartIso: bestSnap.tsIso,
            tsEndIso,
            domain: "battery",
            assetRef: "battery",
            eventType: "battery_reserve_check",
            quality: { decisionQuality: "unknown", outcomeQuality: "unknown" },
            confidence: null,
            snapshotIdRef: bestSnap.id,
            measurements: { requiredSocAtPvEndPct: requiredPct, observedMinSocPct: min, windowCoveragePct: Math.round(coveragePct * 10) / 10 },
            energyImpactKwh: null,
            costImpactCt: null,
            reasonCodes: ["reserve_check_window_undercovered"],
            explanationDe: `Reserve-Ziel ${requiredPct.toFixed(0)}% bekannt seit ${bestSnap.tsIso}, aber Ist-SOC-Tiefpunkt im 18h-Fenster danach nicht belastbar messbar (Coverage ${coveragePct.toFixed(0)}%).`,
            insufficientData: true,
            notApplicable: false,
            userOverride: false,
        });
        return findings;
    }
    const reserveMet = min >= requiredPct;
    findings.push({
        id: `battery-reserve-${day.dateKey}-${fromMs}`,
        dateKey: day.dateKey,
        tsStartIso: bestSnap.tsIso,
        tsEndIso,
        domain: "battery",
        assetRef: "battery",
        eventType: "battery_reserve_check",
        /*
         * decisionQuality bezieht sich hier ausschließlich darauf, ob zum Entscheidungszeitpunkt
         * ein Reserve-Ziel überhaupt ableitbar war (nicht: ob der SPÄTERE Ist-Wert stimmt).
         */
        quality: {
            decisionQuality: "reasonable",
            outcomeQuality: reserveMet ? "reasonable" : "unknown",
        },
        confidence: Math.round(coveragePct),
        snapshotIdRef: bestSnap.id,
        measurements: {
            requiredSocAtPvEndPct: requiredPct,
            observedMinSocPct: min,
            windowCoveragePct: Math.round(coveragePct * 10) / 10,
        },
        energyImpactKwh: null,
        costImpactCt: null,
        reasonCodes: [reserveMet ? "reserve_held" : "reserve_undercut"],
        explanationDe: reserveMet
            ? `Reserve-Ziel ${requiredPct.toFixed(0)}% (bekannt seit ${bestSnap.tsIso}) im Folgefenster eingehalten (Ist-Tiefpunkt ${min.toFixed(0)}%).`
            : `Reserve-Ziel ${requiredPct.toFixed(0)}% (bekannt seit ${bestSnap.tsIso}) im Folgefenster unterschritten (Ist-Tiefpunkt ${min.toFixed(0)}%) — Ursache nicht attribuierbar (keine Quellenzerlegung in der Telemetrie).`,
        insufficientData: false,
        notApplicable: false,
        userOverride: false,
    });
    return findings;
}
exports.evaluateBatteryFindings = evaluateBatteryFindings;
