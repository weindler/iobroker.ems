"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPvContribution = void 0;
const quality_1 = require("../quality");
const types_1 = require("./types");
function isStale(lastUpdateTs, now, maxAgeHours) {
    if (!lastUpdateTs)
        return true;
    const ms = Date.parse(lastUpdateTs);
    if (!Number.isFinite(ms))
        return true;
    return now.getTime() - ms > maxAgeHours * 3_600_000;
}
function buildPvContribution(input) {
    const generatedAt = input.now.toISOString();
    const confidence = (0, types_1.clampConfidencePct)(input.confidencePct);
    const hasForecast = (0, types_1.isPvForecastPresent)(input.correctedTodayKwh, input.correctedTomorrowKwh, input.status);
    const stale = isStale(input.lastUpdateTs, input.now, 36);
    let status = "missing";
    let reasonDe = "Keine gültige PV-Prognose vorhanden.";
    if (hasForecast) {
        if (input.status === "ready" && !stale) {
            status = "valid";
            reasonDe = "Korrigierte PV-Tagesprognose aus Learning PV-Bias.";
        }
        else if (stale) {
            status = "degraded";
            reasonDe = "PV-Prognose vorhanden, aber veraltet.";
        }
        else if (input.status === "insufficient_data") {
            status = "degraded";
            reasonDe = "PV-Prognose mit eingeschränkter Datenbasis.";
        }
        else {
            status = "degraded";
            reasonDe = `PV-Prognose mit Status ${input.status ?? "unbekannt"}.`;
        }
    }
    const todayKey = input.horizonDays.find((d) => d.dayIndex === 0)?.dateKey ?? null;
    const tomorrowKey = input.horizonDays.find((d) => d.dayIndex === 1)?.dateKey ?? null;
    return (0, types_1.baseContribution)((0, types_1.pvContributorRef)(), ["supply"], {
        generatedAt,
        validUntil: null,
        revision: 1,
        enabled: hasForecast,
        flexible: false,
        gridEligible: false,
        quality: (0, quality_1.operatorQuality)(status, reasonDe, confidence),
        reasonDe,
        details: {
            source: input.source,
            lastUpdateTs: input.lastUpdateTs,
            status: input.status,
            correctedTodayKwh: input.correctedTodayKwh,
            correctedTomorrowKwh: input.correctedTomorrowKwh,
            rawTodayKwh: input.rawTodayKwh,
            rawTomorrowKwh: input.rawTomorrowKwh,
            todayDateKey: todayKey,
            tomorrowDateKey: tomorrowKey,
            horizonDays: input.horizonDays,
            slotResolution: "daily_only",
            slotNoteDe: "Keine belastbare 15-Minuten-PV-Leistung — nur Tages-kWh.",
        },
        slots: [],
    });
}
exports.buildPvContribution = buildPvContribution;
