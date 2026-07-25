"use strict";
/**
 * Wetterbasierte PV-Leistungsform pro 15-Minuten-Slot (v0.1.188).
 *
 * Zweck: Die gelernte Tages-kWh (`learning.pv_bias`) bleibt die einzige "Wahrheit" für die
 * Energiemenge — hier wird nur die **Form** über den Tag verteilt, damit Daily Plan/Allocation
 * einen echten PV-Verlauf statt `null` pro Slot bekommen. Keine erfundene Glockenkurve ohne
 * Wetterbezug: Form kommt aus Sonnenstand (Clear-Sky) und, wenn verfügbar, aus stündlicher
 * Bewölkung/Solarschätzung. Ohne Lat/Lon oder ohne gültige Tages-kWh bleibt das Ergebnis leer
 * (kein Fallback auf erfundene Werte).
 *
 * Bewusste Vereinfachungen (dokumentiert, kein Anspruch auf physikalische Exaktheit):
 * - Sonnenstand ohne Zeitgleichung (Equation of Time) — Fehler ca. ±16 Minuten beim Sonnenhöchststand.
 * - Bewölkungs-Dämpfung linear mit Faktor 0,75 (kein spektrales/Kasten-Modell).
 * - `solar_estimate` (falls vorhanden) hat Vorrang vor reiner Bewölkung als Formquelle je Stunde.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPvShapeForDay = exports.clearSkyWeight = exports.solarElevationDeg = void 0;
const CLOUD_DAMPING_FACTOR = 0.75;
const MIN_CLOUD_FACTOR = 0.05;
function degToRad(deg) {
    return (deg * Math.PI) / 180;
}
function radToDeg(rad) {
    return (rad * 180) / Math.PI;
}
function dayOfYearUtc(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 1);
    return Math.floor((date.getTime() - start) / 86_400_000) + 1;
}
/**
 * Näherungsweise Sonnenhöhe in Grad (positiv = über Horizont). Ohne Zeitgleichung/Refraktion —
 * ausreichend genau für eine relative Tagesform, nicht für exakte Auf-/Untergangszeiten.
 */
function solarElevationDeg(date, latDeg, lonDeg) {
    const n = dayOfYearUtc(date);
    const declRad = degToRad(23.45 * Math.sin(degToRad((360 / 365) * (284 + n))));
    const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    const solarTimeHours = utcHours + lonDeg / 15;
    const hourAngleRad = degToRad(15 * (solarTimeHours - 12));
    const latRad = degToRad(latDeg);
    const sinElevation = Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
    return radToDeg(Math.asin(Math.max(-1, Math.min(1, sinElevation))));
}
exports.solarElevationDeg = solarElevationDeg;
/** Clear-Sky-Gewicht ~ sin(Sonnenhöhe); 0 unter dem Horizont. */
function clearSkyWeight(elevationDeg) {
    if (elevationDeg <= 0)
        return 0;
    return Math.sin(degToRad(elevationDeg));
}
exports.clearSkyWeight = clearSkyWeight;
function hourBucketMs(iso) {
    return Math.floor(Date.parse(iso) / 3_600_000) * 3_600_000;
}
/**
 * Verteilt `dailyKwh` als PV-Leistungsform auf die übergebenen 15-Min-Slots eines Kalendertags.
 * Form je Slot: Clear-Sky-Gewicht (Sonnenstand), je Stunde gedämpft durch `solarEstimateKwh`
 * (bevorzugt, proportional auf die Slots der Stunde verteilt) oder `cloudPct` (linear gedämpft).
 * Ohne beide Quellen bleibt die reine Clear-Sky-Form für die Stunde erhalten.
 *
 * Summe(pvPowerW_i × slotDauer_i) über alle Slots ≈ dailyKwh — außer `capW` kappt Spitzen
 * (dann bewusst < dailyKwh, keine erfundene Überschreitung der Anlagenleistung).
 */
function buildPvShapeForDay(slots, dailyKwh, latDeg, lonDeg, hourlyPoints, capW) {
    if (slots.length === 0)
        return [];
    if (dailyKwh === null || !Number.isFinite(dailyKwh) || dailyKwh <= 0)
        return [];
    if (latDeg === null || lonDeg === null || !Number.isFinite(latDeg) || !Number.isFinite(lonDeg))
        return [];
    const hourlyByBucket = new Map();
    for (const p of hourlyPoints) {
        const ms = Date.parse(p.hourStartIso);
        if (Number.isFinite(ms))
            hourlyByBucket.set(hourBucketMs(p.hourStartIso), p);
    }
    const rawWeights = slots.map((s) => {
        const startMs = Date.parse(s.startIso);
        const endMs = Date.parse(s.endIso);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs))
            return 0;
        const elevation = solarElevationDeg(new Date((startMs + endMs) / 2), latDeg, lonDeg);
        return clearSkyWeight(elevation);
    });
    const hourWeightSums = new Map();
    slots.forEach((s, i) => {
        const bucket = hourBucketMs(s.startIso);
        hourWeightSums.set(bucket, (hourWeightSums.get(bucket) ?? 0) + rawWeights[i]);
    });
    const dampedWeights = slots.map((s, i) => {
        const raw = rawWeights[i];
        if (raw <= 0)
            return 0;
        const point = hourlyByBucket.get(hourBucketMs(s.startIso));
        if (!point)
            return raw;
        if (point.solarEstimateKwh !== null && point.solarEstimateKwh >= 0) {
            const hourSum = hourWeightSums.get(hourBucketMs(s.startIso)) ?? 0;
            if (hourSum > 0)
                return raw * (point.solarEstimateKwh / hourSum);
        }
        if (point.cloudPct !== null) {
            const cloudFrac = Math.max(0, Math.min(100, point.cloudPct)) / 100;
            return raw * Math.max(MIN_CLOUD_FACTOR, 1 - cloudFrac * CLOUD_DAMPING_FACTOR);
        }
        return raw;
    });
    const slotHours = slots.map((s) => Math.max(0, Date.parse(s.endIso) - Date.parse(s.startIso)) / 3_600_000);
    const weightedHours = dampedWeights.reduce((sum, w, i) => sum + w * slotHours[i], 0);
    if (weightedHours <= 0) {
        return slots.map((s) => ({ slot: { startIso: s.startIso, endIso: s.endIso }, pvPowerW: 0 }));
    }
    const scaleWPerWeightUnit = (dailyKwh * 1000) / weightedHours;
    return slots.map((s, i) => {
        let pvPowerW = Math.max(0, dampedWeights[i] * scaleWPerWeightUnit);
        if (capW !== null && Number.isFinite(capW) && capW > 0) {
            pvPowerW = Math.min(pvPowerW, capW);
        }
        return { slot: { startIso: s.startIso, endIso: s.endIso }, pvPowerW: Math.round(pvPowerW) };
    });
}
exports.buildPvShapeForDay = buildPvShapeForDay;
