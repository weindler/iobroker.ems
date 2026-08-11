"use strict";
/**
 * Boiler = Warmwasser-Hard-Bedarf | Puffer = Soft-Speicher / Safety-Cap.
 * Keine zweite Planner-Engine — reine Input-Trennung für resolveThermalPlannerEnergy.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBoilerBufferThermalEnergy = exports.bufferSoftHeadroomKwh = exports.thermalHardCoverUntilMs = void 0;
const flex_demand_1 = require("../../contributions/flexible/flex_demand");
const EPS = 1e-9;
const FLOOR_EPS = 0.05;
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
function thermalHardCoverUntilMs(input) {
    const windowEnd = input.currentWindowEndMs;
    if (windowEnd != null && Number.isFinite(windowEnd) && windowEnd > input.nowMs + 60_000) {
        return windowEnd;
    }
    if (input.nextReliablePvMs != null && Number.isFinite(input.nextReliablePvMs)) {
        return input.nextReliablePvMs;
    }
    return null;
}
exports.thermalHardCoverUntilMs = thermalHardCoverUntilMs;
/**
 * Soft-Headroom aus Puffer-Max − Puffer (physikalisch).
 * Contribution darf zusätzlich ein Soft-Ziel ≤ Max liefern — hier Cap.
 */
function bufferSoftHeadroomKwh(input) {
    if (input.bufferTempC === null ||
        input.bufferMaxTempC === null ||
        !(input.bufferMaxTempC > input.bufferTempC)) {
        return 0;
    }
    const cap = input.bufferMaxTempC;
    const target = input.softTargetTempC != null && Number.isFinite(input.softTargetTempC)
        ? Math.min(cap, Math.max(input.bufferTempC, input.softTargetTempC))
        : cap;
    const delta = Math.max(0, target - input.bufferTempC);
    const k = input.kwhPerDegreeC != null && input.kwhPerDegreeC > 0 ? input.kwhPerDegreeC : flex_demand_1.IMMERSION_DEFAULT_KWH_PER_DEGREE_C;
    return round3(delta * k);
}
exports.bufferSoftHeadroomKwh = bufferSoftHeadroomKwh;
/**
 * Hard-Bridge nur aus Boiler. Puffer erzeugt keinen Warmwasser-Hard-Bedarf.
 * Fehlendes Boiler-Learning → keine Fake-emptyAt-Deadline; nur Temp vs Min.
 */
function resolveBoilerBufferThermalEnergy(input) {
    const kwhPerC = input.kwhPerDegreeC != null && input.kwhPerDegreeC > 0
        ? input.kwhPerDegreeC
        : flex_demand_1.IMMERSION_DEFAULT_KWH_PER_DEGREE_C;
    const conf = Number.isFinite(input.pvConfidence01)
        ? Math.max(0.2, Math.min(1, input.pvConfidence01))
        : 0.7;
    const softFromContrib = input.softHeadroomEnergyKwh !== null && Number.isFinite(input.softHeadroomEnergyKwh)
        ? Math.max(0, input.softHeadroomEnergyKwh)
        : 0;
    const softFromBuffer = bufferSoftHeadroomKwh({
        bufferTempC: input.bufferTempC,
        bufferMaxTempC: input.bufferMaxTempC,
        kwhPerDegreeC: kwhPerC,
    });
    /** Contribution-Headroom bevorzugen wenn gesetzt, sonst physikalisches Puffer-Max. */
    const softBase = softFromContrib > EPS ? softFromContrib : softFromBuffer;
    const hygiene = Math.max(0, input.hygieneMandatoryKwh ?? 0);
    if (input.boilerSensorDegraded || input.boilerTempC === null || input.boilerMinTempC === null) {
        return {
            plannerEnergyKwh: round3(softBase + hygiene),
            mandatoryEnergyKwh: round3(hygiene),
            economicHeadroomKwh: round3(softBase),
            coversUntilNextPv: true,
            coverUntilMs: null,
            reasonDe: input.boilerSensorDegraded
                ? "Boiler-Sensor fehlt/stale — kein Buffer-Hard-Fallback; Soft aus Puffer, Hygiene falls fällig."
                : "Boiler-Temperatur fehlt — kein Hard-Warmwasserbedarf aus Puffer.",
            hardFromBoiler: false,
        };
    }
    const coverUntilMs = thermalHardCoverUntilMs(input);
    let hard = 0;
    let covers = true;
    let reasonDe = "";
    /** Sofort-Hard: Boiler unter Mindesttemperatur. */
    if (input.boilerTempC < input.boilerMinTempC - FLOOR_EPS) {
        hard = Math.max(0, input.boilerMinTempC - input.boilerTempC) * kwhPerC;
        covers = false;
        reasonDe = `Boiler ${input.boilerTempC.toFixed(1)} °C unter Min ${input.boilerMinTempC} °C — Hard-Warmwasser.`;
    }
    else if (
    /** Cover-/emptyAt-Hard nur mit belastbarem Boiler-Learning — nie aus erfundener Rate. */
    input.boilerEmptyAtUsable === true &&
        coverUntilMs !== null &&
        coverUntilMs >= input.nowMs - 60_000 &&
        input.boilerCoolingRateCPerH !== null &&
        input.boilerCoolingRateCPerH > 0) {
        const hoursToCover = (coverUntilMs - input.nowMs) / 3600_000;
        const emptyAtKnown = input.boilerEstimatedEmptyAtMs !== null &&
            Number.isFinite(input.boilerEstimatedEmptyAtMs) &&
            input.boilerEstimatedEmptyAtMs > input.nowMs;
        if (emptyAtKnown && input.boilerEstimatedEmptyAtMs >= coverUntilMs - 60_000) {
            hard = 0;
            covers = true;
            reasonDe = `Boiler-emptyAt nach Cover — Hard ~0, Soft aus Puffer.`;
        }
        else {
            const tempAtCover = input.boilerTempC - input.boilerCoolingRateCPerH * Math.max(0, hoursToCover);
            const marginK = conf < 0.7
                ? input.boilerCoolingRateCPerH * Math.max(0, hoursToCover) * ((0.7 - conf) / 0.7) * 0.5
                : 0;
            covers = tempAtCover >= input.boilerMinTempC + marginK - FLOOR_EPS;
            if (!covers) {
                hard = Math.max(0, input.boilerMinTempC + marginK - tempAtCover) * kwhPerC;
                reasonDe = `Boiler-Hard-Bridge ~${round3(hard).toFixed(2)} kWh bis Cover.`;
            }
            else {
                hard = marginK * kwhPerC;
                reasonDe = `Boiler hält bis Cover — Hard ~0, Soft aus Puffer.`;
            }
        }
    }
    else {
        /**
         * Kein belastbares Boiler-Cooling/emptyAt:
         * nur aktuelle Temp vs Min — kein Fake-Abend-Deadline aus Puffer.
         */
        hard = 0;
        covers = true;
        reasonDe =
            "Boiler über Min, Learning noch nicht belastbar — kein Fake-emptyAt-Hard; Soft aus Puffer.";
    }
    const mandatory = round3(hard + hygiene);
    if (hygiene > EPS) {
        reasonDe = `${reasonDe} Hygiene-Hard +${round3(hygiene).toFixed(2)} kWh.`.trim();
    }
    return {
        plannerEnergyKwh: round3(mandatory + softBase),
        mandatoryEnergyKwh: mandatory,
        economicHeadroomKwh: round3(softBase),
        coversUntilNextPv: covers && hygiene <= EPS,
        coverUntilMs,
        reasonDe,
        hardFromBoiler: hard > EPS || hygiene > EPS,
    };
}
exports.resolveBoilerBufferThermalEnergy = resolveBoilerBufferThermalEnergy;
