"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveHealth = exports.formatLiveCacheSummary = exports.refreshLiveCache = void 0;
const tree_paths_1 = require("../tree_paths");
const state_util_1 = require("./state_util");
const BATTERY_SLOTS = [
    { addonId: "battery", role: "soc_pct", liveId: "live.battery.soc_pct", labelDe: "Batterie SOC" },
    {
        addonId: "battery",
        role: "pv_ac_power_w",
        liveId: "live.battery.pv_ac_power_w",
        labelDe: "PV AC Leistung",
    },
    {
        addonId: "battery",
        role: "consumption_w",
        liveId: "live.battery.house_load_w",
        labelDe: "Hauslast",
    },
];
const WALLBOX_SLOTS = [
    {
        addonId: "wallbox",
        role: "set_enabled",
        liveId: "live.wallbox.enabled",
        labelDe: "Wallbox Freigabe",
    },
];
/** Optional: falls später als Mapping-Rolle angelegt. */
const OPTIONAL_SLOTS = [
    {
        addonId: "battery",
        role: "capacity_kwh",
        liveId: "live.battery.capacity_kwh",
        labelDe: "Batteriekapazität",
    },
    {
        addonId: "immersion_heater",
        role: "buffer_temp_c",
        liveId: "live.thermal.buffer_temp_c",
        labelDe: "Puffer-Temperatur",
    },
    {
        addonId: "wallbox",
        role: "vehicle_soc_pct",
        liveId: "live.wallbox.vehicle_soc_pct",
        labelDe: "Fahrzeug-SOC",
    },
    {
        addonId: "dynamic_tariff",
        role: "price_now_ct_per_kwh",
        liveId: "live.price.now_ct_per_kwh",
        labelDe: "Strompreis jetzt",
    },
];
async function readMappedForeign(host, addonId, role) {
    const base = (0, tree_paths_1.mappingBase)(addonId, role);
    const enabledSt = await host.getStateAsync(`${base}.enabled`);
    if (enabledSt?.val === false) {
        return null;
    }
    const targetSt = await host.getStateAsync(`${base}.target_state`);
    const target = targetSt?.val != null ? String(targetSt.val).trim() : "";
    if (!target) {
        return null;
    }
    try {
        const foreign = await host.getForeignStateAsync(target);
        if (!foreign || foreign.val === undefined || foreign.val === null) {
            return { value: null, target };
        }
        return { value: foreign.val, target };
    }
    catch {
        return null;
    }
}
function normalizeLiveValue(liveId, raw) {
    if (raw === null || raw === undefined) {
        return null;
    }
    if (liveId === "live.wallbox.enabled") {
        const b = (0, state_util_1.asBool)(raw);
        return b === null ? null : b ? 1 : 0;
    }
    const n = (0, state_util_1.asNum)(raw);
    return n;
}
async function applySlot(host, slot, result) {
    const mapped = await readMappedForeign(host, slot.addonId, slot.role);
    if (!mapped) {
        result.missing.push(`${slot.labelDe} (addons.${slot.addonId}.mapping.${slot.role})`);
        return;
    }
    const normalized = normalizeLiveValue(slot.liveId, mapped.value);
    if (normalized === null) {
        result.missing.push(`${slot.labelDe} (${mapped.target}: kein Wert)`);
        return;
    }
    try {
        await host.setStateAsync(slot.liveId, { val: normalized, ack: true });
        result.updated.push(slot.liveId);
    }
    catch (e) {
        result.errors.push(`${slot.liveId}: ${String(e)}`);
    }
}
/** PV-Leistung zusätzlich unter live.pv.power_w (gleiche Quelle wie battery.pv_ac_power_w). */
async function mirrorPvPower(host, result) {
    const pv = await host.getStateAsync("live.battery.pv_ac_power_w");
    if (pv?.val == null || pv.val === "") {
        return;
    }
    try {
        await host.setStateAsync("live.pv.power_w", { val: pv.val, ack: true });
        result.updated.push("live.pv.power_w");
    }
    catch (e) {
        result.errors.push(`live.pv.power_w: ${String(e)}`);
    }
}
async function refreshLiveCache(host) {
    const result = { updated: [], missing: [], errors: [] };
    for (const slot of [...BATTERY_SLOTS, ...WALLBOX_SLOTS, ...OPTIONAL_SLOTS]) {
        await applySlot(host, slot, result);
    }
    await mirrorPvPower(host, result);
    return result;
}
exports.refreshLiveCache = refreshLiveCache;
function formatLiveCacheSummary(result) {
    const parts = [];
    if (result.updated.length) {
        parts.push(`Live aktualisiert: ${result.updated.length} Signal(e).`);
    }
    if (result.missing.length) {
        parts.push(`Fehlend/leer: ${result.missing.slice(0, 6).join("; ")}`);
        if (result.missing.length > 6) {
            parts.push(`… +${result.missing.length - 6} weitere`);
        }
    }
    if (result.errors.length) {
        parts.push(`Fehler: ${result.errors.join("; ")}`);
    }
    return parts.join(" ") || "Live-Cache: keine Änderungen.";
}
exports.formatLiveCacheSummary = formatLiveCacheSummary;
function deriveHealth(result, hasExecutionMode) {
    if (result.errors.length > 0) {
        return "degraded";
    }
    if (!hasExecutionMode) {
        return "degraded";
    }
    if (result.updated.length === 0) {
        return "no_live_signals";
    }
    if (result.missing.length > 0) {
        return "partial";
    }
    return "ok";
}
exports.deriveHealth = deriveHealth;
