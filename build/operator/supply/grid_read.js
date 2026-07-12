"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectGridSupplyBuildInput = exports.readDynamicTariffPrice15MinSlots = void 0;
const config_1 = require("../../policy/global/config");
const config_2 = require("../../learning/price_forecast/config");
const tibber_parse_1 = require("../../learning/price_forecast/tibber_parse");
const memory_inventory_1 = require("../../diagnostics/memory_inventory");
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
    (0, memory_inventory_1.recordMemoryInventory)({
        module: "grid_supply",
        checkpoint: "policy_effective_read",
        payloadBytes: raw.length,
    });
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    }
    catch {
        return null;
    }
}
function statePayloadBytes(val) {
    if (val == null)
        return 0;
    if (typeof val === "string")
        return val.length;
    if (typeof val === "object") {
        try {
            return JSON.stringify(val).length;
        }
        catch {
            return 0;
        }
    }
    return String(val).length;
}
/** Liest Tibber Today/Tomorrow-JSON und liefert sortierte 15-min-Preisslots ab now. */
async function readDynamicTariffPrice15MinSlots(host, now) {
    const cfg = (0, config_2.priceForecastConfigFromAdapter)(host.config);
    if (!cfg.todayJsonStateId && !cfg.tomorrowJsonStateId) {
        return [];
    }
    const minStartMs = now.getTime();
    const byStart = new Map();
    let payloadBytes = 0;
    for (const stateId of [cfg.todayJsonStateId, cfg.tomorrowJsonStateId]) {
        if (!stateId)
            continue;
        const raw = await readVal(host, stateId);
        payloadBytes += statePayloadBytes(raw);
        for (const slot of (0, tibber_parse_1.parseTibberPriceJsonTo15MinSlots)(raw, { minStartMs })) {
            byStart.set(slot.slotStartMs, slot);
        }
    }
    (0, memory_inventory_1.recordMemoryInventory)({
        module: "grid_supply",
        checkpoint: "tibber_price_read",
        arrayEntries: byStart.size,
        payloadBytes,
        recordsLoaded: [cfg.todayJsonStateId, cfg.tomorrowJsonStateId].filter(Boolean).length,
    });
    return [...byStart.values()].sort((a, b) => a.slotStartMs - b.slotStartMs);
}
exports.readDynamicTariffPrice15MinSlots = readDynamicTariffPrice15MinSlots;
async function collectGridSupplyBuildInput(host, now) {
    const adminPolicy = (0, config_1.globalPolicyConfigFromAdapter)(host.config);
    const effectivePolicy = await readEffectivePolicySnapshot(host);
    const policyGridImportAllowed = policyBoolValue(effectivePolicy, "economics", "gridImportAllowed") ?? adminPolicy.gridImportAllowed;
    const configuredMaxGridImportW = policyNumberValue(effectivePolicy, "limits", "maxGridImportW") ?? adminPolicy.maxGridImportW;
    const configuredHouseFuseLimitW = policyNumberValue(effectivePolicy, "limits", "houseFuseLimitW") ?? adminPolicy.houseFuseLimitW;
    const [globalMode, currentPriceCtPerKwh, fixedPriceCtPerKwh, dynamicSlots] = await Promise.all([
        readStr(host, "global_modes.active"),
        readNum(host, "live.price.now_ct_per_kwh"),
        readNum(host, "economics.config.fixed_price_ct_per_kwh"),
        readDynamicTariffPrice15MinSlots(host, now),
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
    };
}
exports.collectGridSupplyBuildInput = collectGridSupplyBuildInput;
