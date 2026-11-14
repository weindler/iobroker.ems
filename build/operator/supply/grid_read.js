"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getForecastOnlyPriceStarts = getForecastOnlyPriceStarts;
exports.readDynamicTariffPrice15MinSlots = readDynamicTariffPrice15MinSlots;
exports.collectGridSupplyBuildInput = collectGridSupplyBuildInput;
const config_1 = require("../../policy/global/config");
const config_2 = require("../../learning/price_forecast/config");
const tibber_parse_1 = require("../../learning/price_forecast/tibber_parse");
const run_1 = require("../../learning/energyforecast/run");
const state_util_1 = require("../../ems_light/state_util");
async function readVal(host, stateId) {
    if (!stateId.trim())
        return null;
    const tryRead = async (fn) => {
        if (!fn)
            return null;
        try {
            const st = await fn.call(host, stateId);
            return st?.val ?? null;
        }
        catch {
            return null;
        }
    };
    const foreign = await tryRead(host.getForeignStateAsync);
    if (foreign !== null && foreign !== undefined)
        return foreign;
    return tryRead(host.getStateAsync);
}
async function readNum(host, relId) {
    try {
        const st = await host.getStateAsync(relId);
        return (0, state_util_1.asNum)(st?.val);
    }
    catch {
        return null;
    }
}
async function readStr(host, relId) {
    try {
        const st = await host.getStateAsync(relId);
        if (st?.val == null || st.val === "")
            return null;
        return String(st.val);
    }
    catch {
        return null;
    }
}
function policyBoolValue(snapshot, section, key) {
    const entry = snapshot?.[section]?.[key];
    if (!entry || entry.value === null || entry.value === undefined)
        return null;
    if (typeof entry.value === "boolean")
        return entry.value;
    return null;
}
function policyNumberValue(snapshot, section, key) {
    const entry = snapshot?.[section]?.[key];
    if (!entry || entry.value === null || entry.value === undefined)
        return null;
    const n = typeof entry.value === "number" ? entry.value : parseFloat(String(entry.value));
    return Number.isFinite(n) ? n : null;
}
async function readEffectivePolicySnapshot(host) {
    const raw = await readStr(host, "policy.global.effective_json");
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    }
    catch {
        return null;
    }
}
/**
 * Liest Tibber Today/Tomorrow-JSON und liefert sortierte 15-min-Preisslots ab now.
 * Energyforecast (falls aktiv) füllt nur Zeiten auf, für die kein Tibber-Preis vorliegt — Tibber hat Vorrang.
 */
/** Startzeiten (ms) der zuletzt gelesenen Preisslots, die nur aus der Energyforecast-Prognose stammen (kein Tibber-Preis). */
let forecastOnlyPriceStarts = new Set();
function getForecastOnlyPriceStarts() {
    return forecastOnlyPriceStarts;
}
async function readDynamicTariffPrice15MinSlots(host, now) {
    const cfg = (0, config_2.priceForecastConfigFromAdapter)(host.config);
    const minStartMs = now.getTime();
    const byStart = new Map();
    for (const stateId of [cfg.todayJsonStateId, cfg.tomorrowJsonStateId]) {
        if (!stateId)
            continue;
        const raw = await readVal(host, stateId);
        for (const slot of (0, tibber_parse_1.parseTibberPriceJsonTo15MinSlots)(raw, { minStartMs })) {
            byStart.set(slot.slotStartMs, slot);
        }
    }
    const forecastOnly = new Set();
    for (const slot of (0, run_1.getEnergyforecastPrice15MinSlots)(minStartMs)) {
        if (!byStart.has(slot.slotStartMs)) {
            byStart.set(slot.slotStartMs, slot);
            if (slot.origin === "forecast")
                forecastOnly.add(slot.slotStartMs);
        }
    }
    forecastOnlyPriceStarts = forecastOnly;
    return [...byStart.values()].sort((a, b) => a.slotStartMs - b.slotStartMs);
}
async function collectGridSupplyBuildInput(host, now) {
    const adminPolicy = (0, config_1.globalPolicyConfigFromAdapter)(host.config);
    const effectivePolicy = await readEffectivePolicySnapshot(host);
    const policyGridImportAllowed = policyBoolValue(effectivePolicy, "economics", "gridImportAllowed") ?? adminPolicy.gridImportAllowed;
    const configuredMaxGridImportW = policyNumberValue(effectivePolicy, "limits", "maxGridImportW") ?? adminPolicy.maxGridImportW;
    const configuredHouseFuseLimitW = policyNumberValue(effectivePolicy, "limits", "houseFuseLimitW") ?? adminPolicy.houseFuseLimitW;
    const [globalMode, currentPriceCtPerKwh, fixedPriceCtPerKwh, dynamicSlots, priceLearningStatus, priceLearningAvgPrice7dEur, priceLearningAvgPrice30dEur, priceLearningAvgPrice90dEur,] = await Promise.all([
        readStr(host, "global_modes.active"),
        readNum(host, "live.price.now_ct_per_kwh"),
        readNum(host, "economics.config.fixed_price_ct_per_kwh"),
        readDynamicTariffPrice15MinSlots(host, now),
        readStr(host, "learning.price_learning.status"),
        readNum(host, "learning.price_learning.avg_price_7d"),
        readNum(host, "learning.price_learning.avg_price_30d"),
        readNum(host, "learning.price_learning.avg_price_90d"),
    ]);
    return {
        now,
        globalMode,
        policyGridImportAllowed,
        configuredMaxGridImportW,
        configuredHouseFuseLimitW,
        currentPriceCtPerKwh,
        fixedPriceCtPerKwh,
        dynamicSlots,
        priceLearningStatus,
        priceLearningAvgPrice7dEur,
        priceLearningAvgPrice30dEur,
        priceLearningAvgPrice90dEur,
    };
}
