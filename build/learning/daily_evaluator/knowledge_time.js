"use strict";
/**
 * BLOCK A — Knowledge-Time-Resolver.
 *
 * Trennt strikt "was war zum Entscheidungszeitpunkt bekannt" (Snapshot/Forecast) von
 * "was ist tatsächlich passiert" (Telemetrie-Buckets, reale Preise). Keine Rekonstruktion
 * historischer Entscheidungen mit heutiger Config/heutigem Runtime-State — wenn zu einem
 * Zeitpunkt kein Snapshot existiert, ist decisionQuality für diesen Zeitpunkt insufficient_data.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pvRankPercentileAtDecisionTime = exports.resolveKnownPvAtSlotStart = exports.priceRankPercentileAtDecisionTime = exports.resolveKnownPriceAtSlotStart = exports.resolveKnowledgeSnapshotAt = void 0;
/** Letzter Snapshot mit tsIso <= atMs — null wenn keiner existiert (kein Fallback auf später/früher erfinden). */
function resolveKnowledgeSnapshotAt(day, atMs) {
    let best = null;
    let bestMs = -Infinity;
    for (const s of day.forecastSnapshots) {
        const ms = Date.parse(s.tsIso);
        if (!Number.isFinite(ms) || ms > atMs)
            continue;
        if (ms > bestMs) {
            bestMs = ms;
            best = s;
        }
    }
    return best;
}
exports.resolveKnowledgeSnapshotAt = resolveKnowledgeSnapshotAt;
/**
 * Zum Entscheidungszeitpunkt bekannter Preis für einen Slot-Start (ct/kWh) — aus
 * snapshot.priceSlots (Forecast/Tarif-Snapshot zum Zeitpunkt der Entscheidung), NICHT
 * der tatsächliche Preis. Exaktes Slot-Start-Match; kein Interpolieren.
 */
function resolveKnownPriceAtSlotStart(snapshot, slotStartMs) {
    if (!snapshot)
        return null;
    for (const [startMs, ct] of snapshot.priceSlots) {
        if (startMs === slotStartMs)
            return ct;
    }
    return null;
}
exports.resolveKnownPriceAtSlotStart = resolveKnownPriceAtSlotStart;
/**
 * Perzentil (0–1) eines Preiswerts innerhalb der zum Entscheidungszeitpunkt bekannten
 * Preisreihe (priceSlots desselben Snapshots) — 0 = günstigstes bekanntes Fenster,
 * 1 = teuerstes. null wenn Preisreihe zu kurz (< 4 Slots) für eine sinnvolle Einordnung.
 */
function priceRankPercentileAtDecisionTime(snapshot, priceCtPerKwh) {
    if (!snapshot || priceCtPerKwh == null || !Number.isFinite(priceCtPerKwh))
        return null;
    const values = snapshot.priceSlots.map(([, ct]) => ct).filter((v) => Number.isFinite(v));
    if (values.length < 4)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    let below = 0;
    for (const v of sorted)
        if (v < priceCtPerKwh)
            below++;
    return below / sorted.length;
}
exports.priceRankPercentileAtDecisionTime = priceRankPercentileAtDecisionTime;
/**
 * Zum Entscheidungszeitpunkt bekannte erwartete PV-Energie für einen Slot-Start (kWh) — aus
 * snapshot.pvSlotKwh (Forecast zum Zeitpunkt der Entscheidung), NICHT die tatsächliche PV.
 * Exaktes Slot-Start-Match; kein Interpolieren. Analog `resolveKnownPriceAtSlotStart`.
 */
function resolveKnownPvAtSlotStart(snapshot, slotStartMs) {
    if (!snapshot)
        return null;
    for (const [startMs, kwh] of snapshot.pvSlotKwh) {
        if (startMs === slotStartMs)
            return kwh;
    }
    return null;
}
exports.resolveKnownPvAtSlotStart = resolveKnownPvAtSlotStart;
/**
 * Perzentil (0–1) eines PV-Werts innerhalb der zum Entscheidungszeitpunkt bekannten PV-Reihe
 * (pvSlotKwh desselben Snapshots) — 0 = am wenigsten erwartete PV, 1 = am meisten. null wenn
 * PV-Reihe zu kurz (< 4 Slots). Analog `priceRankPercentileAtDecisionTime`, dieselbe Methode,
 * nur auf die zweite bereits im Snapshot vorhandene Forecast-Reihe angewandt.
 */
function pvRankPercentileAtDecisionTime(snapshot, pvKwh) {
    if (!snapshot || pvKwh == null || !Number.isFinite(pvKwh))
        return null;
    const values = snapshot.pvSlotKwh.map(([, kwh]) => kwh).filter((v) => Number.isFinite(v));
    if (values.length < 4)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    let below = 0;
    for (const v of sorted)
        if (v < pvKwh)
            below++;
    return below / sorted.length;
}
exports.pvRankPercentileAtDecisionTime = pvRankPercentileAtDecisionTime;
