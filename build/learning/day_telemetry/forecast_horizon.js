"use strict";
/**
 * Speicher-Kompaktierung: Preis-/PV-Forecast-Horizont dedupliziert mit Delta-Referenz.
 *
 * Problem: `PlannerKnowledgeSnapshot.priceSlots`/`pvSlotKwh` enthalten den GESAMTEN
 * Preis-/PV-Horizont (typ. ≥192 15-Min-Slots über mehrere Tage). Der Planner-Input enthält
 * für den aktuellen Slot oft einen Live-PV-Override (`operator/daily_plan/unified/
 * from_forecast_context.ts`), der sich bei fast jedem materiellen Replan minimal ändert.
 * Ein reiner Volltext-Hash über das gesamte Array (wie der bestehende, unveränderte
 * `hashPlannerKnowledgeContent` für die In-Memory-Dedup von `forecastSnapshots` selbst)
 * dedupliziert deshalb praktisch nie — jeder Replan-Zyklus dupliziert den kompletten Horizont
 * erneut, was beobachtet zu ~166 nahezu identischen Kopien/Tag (~2,7 MiB) führte.
 *
 * Lösung (rein auf der Persistenz-Ebene, siehe `persist.ts`): EIN vollständiger Horizont
 * ("Basisrevision") pro tatsächlich strukturell/materiell abweichender Forecast-Lage. Jeder
 * Snapshot referenziert die zuletzt passende Basisrevision und trägt nur das MINIMALE Delta
 * der tatsächlich geänderten Slots. Nur wenn die Abweichung zur aktuellen Basisrevision zu
 * groß ist (viele Slots anders, z. B. echte Preisrevision, oder Horizont/Timeline geändert),
 * wird eine neue vollständige Basisrevision angelegt — genau die vom Nutzer geforderte
 * "nur bei materieller Forecast-Änderung ein neuer vollständiger Snapshot"-Semantik.
 *
 * Verlustfrei: `rehydrateForecastRevisions` rekonstruiert exakt die zum Snapshot-Zeitpunkt
 * bekannten Arrays (Basis + Delta angewendet) — keine Rundung, keine Interpolation, keine
 * Näherung. In-Memory (nach dem Lesen) ist ein Snapshot ununterscheidbar von einem, der nie
 * kompaktiert wurde — jeder bestehende Leser (Daily Evaluator, `record.ts`-Dedup,
 * `knowledge_time.ts`, Tests) funktioniert unverändert.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rehydrateForecastRevisions = exports.compactForecastSnapshotsForPersist = exports.FORECAST_HORIZON_DELTA_MIN_ABS = exports.FORECAST_HORIZON_DELTA_MAX_RATIO = void 0;
const node_crypto_1 = require("node:crypto");
/**
 * Ab diesem Anteil unterschiedlicher Slots (ggü. der aktuellen Basisrevision) gilt der
 * Forecast als materiell geändert → neue vollständige Basisrevision statt Delta.
 */
exports.FORECAST_HORIZON_DELTA_MAX_RATIO = 0.15;
/** Mindestanzahl Slots, die auch bei kleinem Horizont noch als "nur Delta" akzeptiert werden. */
exports.FORECAST_HORIZON_DELTA_MIN_ABS = 6;
function hashHorizon(priceSlots, pvSlotKwh) {
    const payload = JSON.stringify({ priceSlots, pvSlotKwh });
    return (0, node_crypto_1.createHash)("sha256").update(payload).digest("hex").slice(0, 16);
}
/** Gleiche Timeline = gleiche Länge UND gleiche Slot-Startzeiten an jeder Position. */
function sameTimeline(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i][0] !== b[i][0])
            return false;
    }
    return true;
}
/** null = Timeline weicht ab (Länge/Startzeiten) → kein Delta möglich, neue Basis nötig. */
function diffSlots(base, next) {
    if (!sameTimeline(base, next))
        return null;
    const delta = [];
    for (let i = 0; i < next.length; i++) {
        if (base[i][1] !== next[i][1])
            delta.push([i, next[i][1]]);
    }
    return delta;
}
function deltaWithinBudget(deltaLen, totalLen) {
    if (totalLen === 0)
        return true;
    const budget = Math.max(exports.FORECAST_HORIZON_DELTA_MIN_ABS, Math.ceil(totalLen * exports.FORECAST_HORIZON_DELTA_MAX_RATIO));
    return deltaLen <= budget;
}
function applyDelta(base, delta) {
    const out = base.map((e) => [e[0], e[1]]);
    if (!delta?.length)
        return out;
    for (const [idx, val] of delta) {
        if (idx >= 0 && idx < out.length)
            out[idx] = [out[idx][0], val];
    }
    return out;
}
/**
 * Kompaktiert `day.forecastSnapshots` für die Persistenz: extrahiert deduplizierte
 * Basisrevisionen (`forecastRevisions`) und ersetzt volle Preis-/PV-Arrays je Snapshot durch
 * eine Referenz (`forecastRevisionId`) + minimalem Delta. Baut IMMER frisch aus den (in-memory
 * stets vollständigen) `day.forecastSnapshots` auf — deterministisch, kein Drift durch alte
 * Zwischenstände. Gibt ein NEUES Objekt zurück; `day` selbst (z. B. der In-Memory-Dedup-Cache
 * in `record.ts`) bleibt unverändert und behält seine vollen Arrays.
 */
function compactForecastSnapshotsForPersist(day) {
    if (!day.forecastSnapshots?.length)
        return day;
    const revisions = [];
    let currentBase = null;
    const compactSnapshots = day.forecastSnapshots.map((snap) => {
        const priceDelta = currentBase ? diffSlots(currentBase.priceSlots, snap.priceSlots) : null;
        const pvDelta = currentBase ? diffSlots(currentBase.pvSlotKwh, snap.pvSlotKwh) : null;
        const canDelta = currentBase != null &&
            priceDelta != null &&
            pvDelta != null &&
            deltaWithinBudget(priceDelta.length, currentBase.priceSlots.length) &&
            deltaWithinBudget(pvDelta.length, currentBase.pvSlotKwh.length);
        if (canDelta && currentBase && priceDelta && pvDelta) {
            return {
                ...snap,
                priceSlots: [],
                pvSlotKwh: [],
                forecastRevisionId: currentBase.id,
                forecastPriceDelta: priceDelta.length ? priceDelta : undefined,
                forecastPvDelta: pvDelta.length ? pvDelta : undefined,
            };
        }
        /* Materielle Abweichung (oder erste Revision dieses Tages) → neue vollständige Basis. */
        const id = hashHorizon(snap.priceSlots, snap.pvSlotKwh);
        const existing = revisions.find((r) => r.id === id);
        const rev = existing ?? { id, tsIso: snap.tsIso, priceSlots: snap.priceSlots, pvSlotKwh: snap.pvSlotKwh };
        if (!existing)
            revisions.push(rev);
        currentBase = rev;
        return {
            ...snap,
            priceSlots: [],
            pvSlotKwh: [],
            forecastRevisionId: rev.id,
            forecastPriceDelta: undefined,
            forecastPvDelta: undefined,
        };
    });
    return { ...day, forecastSnapshots: compactSnapshots, forecastRevisions: revisions };
}
exports.compactForecastSnapshotsForPersist = compactForecastSnapshotsForPersist;
/**
 * Rekonstruiert `priceSlots`/`pvSlotKwh` für jeden kompaktierten Snapshot verlustfrei
 * (Basisrevision + Delta). Mutiert `day` in place — nur direkt nach dem Einlesen (JSON.parse)
 * aufrufen, analog zu den übrigen Normalisierungsschritten in `persist.ts`. Snapshots ohne
 * `forecastRevisionId` (ältere Tagesdateien mit noch vollständig inline gespeicherten Arrays)
 * bleiben unverändert — volle Rückwärtskompatibilität.
 */
function rehydrateForecastRevisions(day) {
    if (!Array.isArray(day.forecastRevisions) || day.forecastRevisions.length === 0)
        return;
    if (!Array.isArray(day.forecastSnapshots) || day.forecastSnapshots.length === 0)
        return;
    const byId = new Map(day.forecastRevisions.map((r) => [r.id, r]));
    for (const snap of day.forecastSnapshots) {
        const revId = snap.forecastRevisionId;
        if (!revId)
            continue;
        const rev = byId.get(revId);
        if (!rev)
            continue;
        snap.priceSlots = applyDelta(rev.priceSlots, snap.forecastPriceDelta);
        snap.pvSlotKwh = applyDelta(rev.pvSlotKwh, snap.forecastPvDelta);
    }
}
exports.rehydrateForecastRevisions = rehydrateForecastRevisions;
