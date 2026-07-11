"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWeatherContribution = void 0;
const quality_1 = require("../quality");
const contributor_1 = require("../contributor");
const contribution_ids_1 = require("../contribution_ids");
const types_1 = require("./types");
function buildWeatherContribution(input) {
    const generatedAt = input.now.toISOString();
    const confidence = (0, types_1.clampConfidencePct)(input.confidencePct);
    const hasTemp = input.outdoorTempC !== null || input.hourlyPoints.some((p) => p.outdoorTempC !== null);
    const hasContext = hasTemp ||
        input.cloudPct !== null ||
        input.todayMinTempC !== null ||
        input.todayMaxTempC !== null;
    let status = "missing";
    let reasonDe = "Keine Wetter-Kontextdaten vorhanden.";
    if (hasContext) {
        const learningOk = input.learningStatus === "ready" ||
            input.learningHealth === "ok" ||
            input.learningHealth === "degraded";
        if (learningOk || input.outdoorTempC !== null) {
            status = input.learningHealth === "degraded" ? "degraded" : "valid";
            reasonDe = "Wetter-Kontext für Planung (keine elektrische Energiebilanz).";
        }
        else {
            status = "degraded";
            reasonDe = "Wetterdaten eingeschränkt verfügbar.";
        }
    }
    const slots = input.hourlyPoints.map((point) => ({
        slot: { startIso: point.startIso, endIso: point.endIso },
        minPowerW: null,
        preferredPowerW: null,
        maxPowerW: null,
        requiredEnergyKwh: null,
        availableEnergyKwh: null,
        priceCtPerKwh: null,
        available: point.outdoorTempC !== null || point.cloudPct !== null,
        mandatory: false,
        quality: (0, quality_1.operatorQuality)(point.outdoorTempC !== null || point.cloudPct !== null ? "valid" : "missing", "Wetter-Kontext-Slot.", confidence),
    }));
    return (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.WEATHER_CONTEXT, (0, contributor_1.addonContributorRef)((0, types_1.weatherForecastAddonId)()), "context", ["context"], {
        generatedAt,
        validUntil: input.forecastHorizonEnd,
        revision: 1,
        enabled: hasContext,
        flexible: false,
        gridEligible: false,
        quality: (0, quality_1.operatorQuality)(status, reasonDe, confidence),
        reasonDe,
        details: {
            learningStatus: input.learningStatus,
            learningHealth: input.learningHealth,
            lastUpdate: input.lastUpdate,
            forecastSource: input.forecastSource,
            actualSource: input.actualSource,
            outdoorTempC: input.outdoorTempC,
            cloudPct: input.cloudPct,
            todayMinTempC: input.todayMinTempC,
            todayMaxTempC: input.todayMaxTempC,
            tomorrowMinTempC: input.tomorrowMinTempC,
            tomorrowMaxTempC: input.tomorrowMaxTempC,
            forecastHorizonStart: input.forecastHorizonStart,
            forecastHorizonEnd: input.forecastHorizonEnd,
            hourlyPoints: input.hourlyPoints,
            contextOnly: true,
            slotNoteDe: "Wetter liefert Kontext — keine kWh-Bilanz.",
        },
        slots,
    });
}
exports.buildWeatherContribution = buildWeatherContribution;
