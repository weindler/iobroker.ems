"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.measuredMobilityCost = void 0;
/** Nur zeitgleiche Messwerte; ein fehlender Ladeslot verhindert einen Geldvergleich. */
function measuredMobilityCost(day, feedInCtPerKwh) {
    if (feedInCtPerKwh === null || feedInCtPerKwh < 0)
        return null;
    let charged = 0;
    let pvCharged = 0;
    let cost = 0;
    let observed = false;
    const runs = [];
    let run = null;
    const flush = () => {
        if (!run)
            return;
        const value = run;
        runs.push({ dateKey: day.dateKey,
            startedAtIso: new Date(day.startMs + value.first * day.slotWidthMs).toISOString(),
            endedAtIso: new Date(day.startMs + (value.last + 1) * day.slotWidthMs).toISOString(),
            chargedKwh: Math.round(value.charged * 1000) / 1000,
            directPvKwh: Math.round(value.pv * 1000) / 1000,
            costEur: Math.round(value.cost * 100) / 100,
            chargeDurationMin: Math.round(value.minutes),
        });
        run = null;
    };
    for (let i = 0; i < day.slotCount; i++) {
        const ev = day.buckets.evChargedKwh[i];
        if (ev === null || ev === undefined || !Number.isFinite(ev))
            continue;
        observed = true;
        if (ev <= 0)
            continue;
        if (run && i - run.last > 4)
            flush();
        const house = day.buckets.houseTotalKwh[i];
        const pv = day.buckets.pvKwh[i];
        const exported = day.buckets.gridExportKwh[i];
        const price = day.buckets.priceCtPerKwh[i];
        if (house === null || house === undefined || house <= 0 || pv === null || pv === undefined ||
            exported === null || exported === undefined || !Number.isFinite(house) ||
            !Number.isFinite(pv) || !Number.isFinite(exported))
            return null;
        const directPv = Math.min(ev, ev * Math.max(0, Math.min(pv, pv - Math.max(0, exported))) / house);
        const other = ev - directPv;
        if (other > 0.00001 && (price === null || price === undefined || !Number.isFinite(price) || price < 0))
            return null;
        charged += ev;
        pvCharged += directPv;
        const slotCost = (directPv * feedInCtPerKwh + other * (price ?? 0)) / 100;
        cost += slotCost;
        if (!run)
            run = { first: i, last: i, charged: 0, pv: 0, cost: 0, minutes: 0 };
        run.last = i;
        run.charged += ev;
        run.pv += directPv;
        run.cost += slotCost;
        run.minutes += day.slotWidthMs / 60_000;
    }
    flush();
    if (!observed)
        return null;
    return { chargedKwh: Math.round(charged * 1000) / 1000,
        pvKwh: Math.round(pvCharged * 1000) / 1000,
        otherKwh: Math.round((charged - pvCharged) * 1000) / 1000,
        costEur: Math.round(cost * 100) / 100, runs };
}
exports.measuredMobilityCost = measuredMobilityCost;
