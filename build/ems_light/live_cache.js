"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveHealth = exports.formatLiveCacheSummary = exports.refreshLiveCache = exports.refreshLivePowerStrip = void 0;
const state_util_1 = require("./state_util");
const mapping_resolve_1 = require("../mapping_resolve");
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
    {
        addonId: "battery",
        role: "capacity_kwh",
        liveId: "live.battery.capacity_kwh",
        labelDe: "Batteriekapazität",
    },
];
const IMMERSION_SLOTS = [
    {
        addonId: "immersion_heater",
        role: "buffer_temp_c",
        liveId: "live.thermal.buffer_temp_c",
        labelDe: "Puffer-Temperatur",
    },
    {
        addonId: "immersion_heater",
        role: "boiler_temp_c",
        liveId: "live.thermal.boiler_temp_c",
        labelDe: "Boiler-Temperatur",
    },
];
const TARIFF_SLOTS = [
    {
        addonId: "dynamic_tariff",
        role: "price_now_ct_per_kwh",
        liveId: "live.price.now_ct_per_kwh",
        labelDe: "Strompreis jetzt",
    },
];
async function readMappedForeign(host, addonId, role) {
    const mapped = (0, mapping_resolve_1.resolveMappingTargetFromConfig)(host.config, addonId, role);
    if (!mapped || !mapped.enabled) {
        return null;
    }
    const target = mapped.targetState;
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
    if (liveId === "live.price.now_ct_per_kwh") {
        const eurPerKwh = (0, state_util_1.asNum)(raw);
        if (eurPerKwh === null) {
            return null;
        }
        // Quelle z. B. Tibber: €/kWh (0.1576) → EMS-Light ct/kWh (15.76)
        return eurPerKwh * 100;
    }
    const n = (0, state_util_1.asNum)(raw);
    return n;
}
async function writeLiveValue(host, liveId, val, result, ifChanged) {
    try {
        if (ifChanged) {
            const cur = await host.getStateAsync(liveId);
            if (cur?.val === val) {
                return;
            }
        }
        await host.setStateAsync(liveId, { val, ack: true });
        result.updated.push(liveId);
    }
    catch (e) {
        result.errors.push(`${liveId}: ${String(e)}`);
    }
}
async function applySlot(host, slot, result, ifChanged = false) {
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
    await writeLiveValue(host, slot.liveId, normalized, result, ifChanged);
}
/** PV-Leistung zusätzlich unter live.pv.power_w (gleiche Quelle wie battery.pv_ac_power_w). */
async function mirrorPvPower(host, result, ifChanged = false) {
    const pv = await host.getStateAsync("live.battery.pv_ac_power_w");
    if (pv?.val == null || pv.val === "") {
        return;
    }
    await writeLiveValue(host, "live.pv.power_w", pv.val, result, ifChanged);
}
const POWER_STRIP_ROLES = new Set(["soc_pct", "pv_ac_power_w", "consumption_w"]);
/**
 * PV / Haus / SOC / Preis für die VIS-Kopfzeile.
 * Läuft auf dem Batterie-Tick (ca. 5 s + on-change), nicht erst auf dem 60 s Phase-1-Tick.
 * Thermal und Kapazität bleiben auf dem langsamen Tick.
 */
async function refreshLivePowerStrip(host) {
    const result = { updated: [], missing: [], errors: [] };
    for (const slot of BATTERY_SLOTS) {
        if (!POWER_STRIP_ROLES.has(slot.role)) {
            continue;
        }
        await applySlot(host, slot, result, true);
    }
    for (const slot of TARIFF_SLOTS) {
        await applySlot(host, slot, result, true);
    }
    await mirrorPvPower(host, result, true);
    return result;
}
exports.refreshLivePowerStrip = refreshLivePowerStrip;
async function refreshLiveCache(host) {
    const result = { updated: [], missing: [], errors: [] };
    for (const slot of [...BATTERY_SLOTS, ...IMMERSION_SLOTS, ...TARIFF_SLOTS]) {
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
