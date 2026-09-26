"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.measuredMobilityCost = void 0;
/** Gemessene Ladung behalten; fehlende zeitgleiche Quellen sperren nur die monetäre Bewertung. */
function measuredMobilityCost(day, feedInCtPerKwh) {
    let charged = 0;
    let pvCharged = 0;
    let cost = 0;
    let pvKnown = true;
    let costKnown = true;
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
            directPvKwh: value.pvKnown ? Math.round(value.pv * 1000) / 1000 : null,
            costEur: value.costKnown ? Math.round(value.cost * 100) / 100 : null,
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
        if (!run)
            run = { first: i, last: i, charged: 0, pv: 0, pvKnown: true,
                cost: 0, costKnown: true, minutes: 0 };
        run.last = i;
        run.charged += ev;
        run.minutes += day.slotWidthMs / 60_000;
        charged += ev;
        const house = day.buckets.houseTotalKwh[i];
        const pv = day.buckets.pvKwh[i];
        const exported = day.buckets.gridExportKwh[i];
        const price = day.buckets.priceCtPerKwh[i];
        if (house === null || house === undefined || house <= 0 || pv === null || pv === undefined ||
            exported === null || exported === undefined || !Number.isFinite(house) ||
            !Number.isFinite(pv) || !Number.isFinite(exported)) {
            pvKnown = false;
            costKnown = false;
            run.pvKnown = false;
            run.costKnown = false;
            continue;
        }
        const directPv = Math.min(ev, ev * Math.max(0, Math.min(pv, pv - Math.max(0, exported))) / house);
        const other = ev - directPv;
        pvCharged += directPv;
        run.pv += directPv;
        if ((directPv > 0.00001 && (feedInCtPerKwh === null || feedInCtPerKwh < 0)) ||
            (other > 0.00001 && (price === null || price === undefined || !Number.isFinite(price) || price < 0))) {
            costKnown = false;
            run.costKnown = false;
            continue;
        }
        const slotCost = (directPv * (feedInCtPerKwh ?? 0) + other * (price ?? 0)) / 100;
        cost += slotCost;
        run.cost += slotCost;
    }
    flush();
    if (!observed)
        return null;
    return { chargedKwh: Math.round(charged * 1000) / 1000,
        pvKwh: pvKnown ? Math.round(pvCharged * 1000) / 1000 : null,
        otherKwh: pvKnown ? Math.round((charged - pvCharged) * 1000) / 1000 : null,
        costEur: costKnown ? Math.round(cost * 100) / 100 : null, runs };
}
exports.measuredMobilityCost = measuredMobilityCost;
