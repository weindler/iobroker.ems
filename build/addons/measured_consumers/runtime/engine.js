"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetMeasuredConsumersEngineForTest = exports.stopMeasuredConsumersRuntimeEngine = exports.initMeasuredConsumersRuntimeEngine = exports.hydrateMeasuredConsumersPersist = exports.runMeasuredConsumersTick = void 0;
/**
 * Runtime-Tick für den rein messenden Verbraucherblock.
 *
 * WICHTIG: Dieses Modul schreibt NIEMALS auf Fremd-/Gerätegeräte. Es liest nur
 * Leistungs-/Energie-Datenpunkte und veröffentlicht Anzeige-/Statistik-States.
 * Keine Planner-/Dispatch-Integration, keine Governance/Execution-Mode nötig.
 */
const state_write_1 = require("../../../policy/core/state_write");
const time_1 = require("../../../operator/time");
const constants_1 = require("../constants");
const config_1 = require("../config");
const math_1 = require("../math");
const persist_1 = require("../persist");
const persist_io_1 = require("../persist_io");
const ensure_states_1 = require("./ensure_states");
const state_ids_1 = require("./state_ids");
let engineActive = false;
let hostRef = null;
let persist = (0, persist_1.emptyMeasuredConsumersPersist)();
let persistHydrated = false;
let tickTimer = null;
let overflowWarned = false;
function clearTick() {
    if (tickTimer) {
        clearTimeout(tickTimer);
        tickTimer = null;
    }
}
function scheduleTick(delayMs = constants_1.MEASURED_CONSUMERS_TICK_MS) {
    clearTick();
    if (!engineActive)
        return;
    tickTimer = setTimeout(() => {
        tickTimer = null;
        if (!engineActive || !hostRef)
            return;
        void runMeasuredConsumersTick(hostRef)
            .catch((e) => hostRef?.log.warn(`measured_consumers tick: ${e}`))
            .finally(() => scheduleTick());
    }, delayMs);
}
function resolveTimezone(config) {
    const raw = config && typeof config === "object" ? config : {};
    const tz = typeof raw.timezone === "string" ? raw.timezone.trim() : "";
    return tz || "Europe/Berlin";
}
async function readForeignNum(host, id) {
    if (!id)
        return null;
    const reader = host.getForeignStateAsync ?? host.getStateAsync;
    try {
        const st = await reader(id);
        if (!st || st.val === null || st.val === undefined)
            return null;
        if (typeof st.val === "number")
            return Number.isFinite(st.val) ? st.val : null;
        const n = parseFloat(String(st.val).trim().replace(",", "."));
        return Number.isFinite(n) ? n : null;
    }
    catch {
        return null;
    }
}
/** Adapter-lokale States (z. B. live.battery.house_load_w) — nie getForeignStateAsync. */
async function readLocalNum(host, id) {
    if (!id)
        return null;
    try {
        const st = await host.getStateAsync(id);
        if (!st || st.val === null || st.val === undefined)
            return null;
        if (typeof st.val === "number")
            return Number.isFinite(st.val) ? st.val : null;
        const n = parseFloat(String(st.val).trim().replace(",", "."));
        return Number.isFinite(n) ? n : null;
    }
    catch {
        return null;
    }
}
async function readEnergyUnitHint(host, energyStateId) {
    const reader = host.getForeignObjectAsync ?? host.getObjectAsync;
    if (!reader)
        return null;
    try {
        const obj = await reader(energyStateId);
        const unit = obj?.common && typeof obj.common.unit === "string"
            ? String(obj.common.unit).trim()
            : "";
        if (!unit) {
            return "Hinweis: Energy-DP ohne common.unit — erwartet wird kWh (keine automatische Umrechnung)";
        }
        const u = unit.toLowerCase();
        if (u === "kwh" || u === "kw·h" || u === "kw.h")
            return null;
        if (u === "wh") {
            return "WARNUNG: Energy-DP Einheit ist Wh — Admin erwartet kWh (keine automatische Umrechnung)";
        }
        return `Hinweis: Energy-DP Einheit „${unit}“ — erwartet wird kWh (keine automatische Umrechnung)`;
    }
    catch {
        return "Hinweis: Energy-DP-Objekt nicht lesbar — Einheit unbekannt, erwartet wird kWh";
    }
}
async function processSlot(host, slot, nowMs, todayKey, yesterdayKey) {
    const ids = (0, state_ids_1.measuredConsumerSlotStateIds)(slot.index);
    await (0, state_write_1.setStateIfChanged)(host, ids.name, slot.name);
    await (0, state_write_1.setStateIfChanged)(host, ids.enabled, slot.enabled);
    const zeroTotals = { totalKwh: 0, todayKwh: 0, yesterdayKwh: 0, monthKwh: 0, yearKwh: 0 };
    if (!slot.enabled) {
        await (0, state_write_1.setOptionalNumberIfChanged)(host, ids.powerW, null);
        await (0, state_write_1.setStateIfChanged)(host, ids.sourceMode, "none");
        await (0, state_write_1.setStateIfChanged)(host, ids.valid, false);
        await (0, state_write_1.setStateIfChanged)(host, ids.reasonDe, "Deaktiviert");
        return { powerW: null, enabled: false, valid: false, sourceMode: "none", totals: zeroTotals };
    }
    if (!slot.powerStateId) {
        await (0, state_write_1.setOptionalNumberIfChanged)(host, ids.powerW, null);
        await (0, state_write_1.setStateIfChanged)(host, ids.sourceMode, "none");
        await (0, state_write_1.setStateIfChanged)(host, ids.valid, false);
        await (0, state_write_1.setStateIfChanged)(host, ids.reasonDe, "Kein Leistungs-Datenpunkt konfiguriert");
        return { powerW: null, enabled: true, valid: false, sourceMode: "none", totals: zeroTotals };
    }
    const key = slot.powerStateId;
    let sp = persist.slots[key];
    if (!sp) {
        sp = (0, persist_1.emptyMeasuredConsumerSlotPersist)();
        persist.slots[key] = sp;
    }
    const powerRaw = await readForeignNum(host, slot.powerStateId);
    let powerW = null;
    let valid = true;
    let reasonDe = "";
    if (powerRaw === null) {
        valid = false;
        reasonDe = "Leistungs-Datenpunkt nicht verfügbar";
    }
    else if (powerRaw < 0) {
        valid = false;
        powerW = 0;
        reasonDe = "Negative Leistung ignoriert (auf 0 gesetzt)";
    }
    else {
        powerW = (0, math_1.round1)(powerRaw);
    }
    let sourceMode;
    if (slot.energyStateId) {
        sourceMode = "energy_state";
        const rawKwh = await readForeignNum(host, slot.energyStateId);
        if (rawKwh !== null && rawKwh >= 0) {
            (0, math_1.applyEnergyStateSample)(sp, rawKwh, slot.initialEnergyKwh, todayKey);
        }
        else {
            valid = false;
            reasonDe = reasonDe || "Energie-Datenpunkt nicht verfügbar — Zähler pausiert";
        }
        const unitHint = await readEnergyUnitHint(host, slot.energyStateId);
        if (unitHint && !reasonDe) {
            reasonDe = unitHint;
        }
        else if (unitHint && reasonDe && !reasonDe.includes("WARNUNG") && !reasonDe.includes("Hinweis")) {
            reasonDe = `${reasonDe}; ${unitHint}`;
        }
    }
    else if (powerW !== null && valid) {
        sourceMode = "power_integration";
        (0, math_1.applyPowerIntegrationSample)(sp, powerW, nowMs, slot.initialEnergyKwh, todayKey, constants_1.MEASURED_CONSUMERS_MAX_POWER_INTEGRATION_DT_SEC);
    }
    else {
        sourceMode = "power_integration";
        (0, math_1.skipPowerIntegrationGap)(sp, nowMs);
    }
    sp.days = (0, math_1.pruneOldDays)(sp.days, todayKey, constants_1.MEASURED_CONSUMERS_DAY_RETENTION_DAYS);
    const totals = (0, math_1.resolveSlotPeriods)(sp, todayKey, yesterdayKey);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ids.powerW, powerW);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ids.energyTotalKwh, totals.totalKwh);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ids.energyTodayKwh, totals.todayKwh);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ids.energyYesterdayKwh, totals.yesterdayKwh);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ids.energyMonthKwh, totals.monthKwh);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ids.energyYearKwh, totals.yearKwh);
    await (0, state_write_1.setStateIfChanged)(host, ids.sourceMode, sourceMode);
    await (0, state_write_1.setStateIfChanged)(host, ids.valid, valid);
    await (0, state_write_1.setStateIfChanged)(host, ids.reasonDe, reasonDe);
    return { powerW, enabled: true, valid, sourceMode, totals };
}
async function runMeasuredConsumersTick(host) {
    await hydrateMeasuredConsumersPersist(host);
    const slots = (0, config_1.configuredMeasuredConsumerSlots)(host.config);
    await (0, ensure_states_1.ensureMeasuredConsumersStates)(host, slots);
    if (slots.length === 0) {
        // Keine Zeilen konfiguriert — bewusst kein State-Baum (hält die Oberfläche minimal).
        return;
    }
    const overflow = (0, config_1.measuredConsumerOverflowCount)(host.config);
    if (overflow > 0 && !overflowWarned) {
        host.log.warn(`measured_consumers: ${overflow} Zeile(n) über der Admin-Kapazität (${slots.length}/20) werden ignoriert`);
        overflowWarned = true;
    }
    else if (overflow === 0) {
        overflowWarned = false;
    }
    const timezone = resolveTimezone(host.config);
    const now = new Date();
    const nowMs = now.getTime();
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const yesterdayKey = (0, time_1.addDaysToDateKey)(todayKey, -1);
    let totalPowerW = 0;
    let totalTodayKwh = 0;
    let totalYesterdayKwh = 0;
    let totalMonthKwh = 0;
    let totalYearKwh = 0;
    let totalTotalKwh = 0;
    let activeCount = 0;
    const consumersSummary = [];
    for (const slot of slots) {
        const result = await processSlot(host, slot, nowMs, todayKey, yesterdayKey);
        consumersSummary.push({
            index: slot.index,
            name: slot.name,
            enabled: result.enabled,
            valid: result.valid,
            sourceMode: result.sourceMode,
            powerW: result.powerW,
            energyTotalKwh: result.totals.totalKwh,
            energyTodayKwh: result.totals.todayKwh,
            energyYesterdayKwh: result.totals.yesterdayKwh,
            energyMonthKwh: result.totals.monthKwh,
            energyYearKwh: result.totals.yearKwh,
        });
        if (result.enabled && result.valid) {
            activeCount++;
            totalPowerW += result.powerW ?? 0;
            totalTodayKwh += result.totals.todayKwh;
            totalYesterdayKwh += result.totals.yesterdayKwh;
            totalMonthKwh += result.totals.monthKwh;
            totalYearKwh += result.totals.yearKwh;
            totalTotalKwh += result.totals.totalKwh;
        }
    }
    const houseLoadW = await readLocalNum(host, constants_1.MEASURED_CONSUMERS_HOUSE_LOAD_STATE_ID);
    const unknownHouseLoadW = (0, math_1.computeUnknownHouseLoadW)(houseLoadW, totalPowerW);
    const s = state_ids_1.MEASURED_CONSUMERS_AGGREGATE_STATES;
    await (0, state_write_1.setOptionalNumberIfChanged)(host, s.totalPowerW, (0, math_1.round1)(totalPowerW));
    await (0, state_write_1.setOptionalNumberIfChanged)(host, s.totalEnergyTodayKwh, totalTodayKwh);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, s.totalEnergyYesterdayKwh, totalYesterdayKwh);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, s.totalEnergyMonthKwh, totalMonthKwh);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, s.totalEnergyYearKwh, totalYearKwh);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, s.totalEnergyTotalKwh, totalTotalKwh);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, s.unknownHouseLoadW, unknownHouseLoadW);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, s.houseLoadW, houseLoadW);
    await (0, state_write_1.setStateIfChanged)(host, s.houseLoadAvailable, houseLoadW !== null);
    await (0, state_write_1.setStateIfChanged)(host, s.activeSlotCount, activeCount);
    await (0, state_write_1.setStateIfChanged)(host, s.consumersJson, JSON.stringify(consumersSummary));
    await (0, state_write_1.setStateIfChanged)(host, s.lastTickIso, now.toISOString());
    await (0, state_write_1.setStateIfChanged)(host, s.reasonDe, slots.length === 0 ? "Keine gemessenen Verbraucher konfiguriert" : "");
    const baseDir = host.getAbsolutePath?.("measured_consumers");
    if (baseDir) {
        await (0, persist_io_1.writeMeasuredConsumersPersist)(baseDir, persist).catch((e) => host.log.debug?.(`measured_consumers persist write: ${e}`));
    }
}
exports.runMeasuredConsumersTick = runMeasuredConsumersTick;
async function hydrateMeasuredConsumersPersist(host) {
    if (persistHydrated)
        return;
    const dataDir = host.getAbsolutePath?.("measured_consumers");
    if (dataDir) {
        persist = await (0, persist_io_1.readMeasuredConsumersPersist)(dataDir);
    }
    persistHydrated = true;
}
exports.hydrateMeasuredConsumersPersist = hydrateMeasuredConsumersPersist;
async function initMeasuredConsumersRuntimeEngine(host) {
    if (engineActive && hostRef === host)
        return;
    engineActive = true;
    hostRef = host;
    await hydrateMeasuredConsumersPersist(host);
    const slots = (0, config_1.configuredMeasuredConsumerSlots)(host.config);
    await (0, ensure_states_1.ensureMeasuredConsumersStates)(host, slots);
    scheduleTick(1000);
}
exports.initMeasuredConsumersRuntimeEngine = initMeasuredConsumersRuntimeEngine;
function stopMeasuredConsumersRuntimeEngine() {
    engineActive = false;
    clearTick();
    const host = hostRef;
    if (host) {
        const baseDir = host.getAbsolutePath?.("measured_consumers");
        if (baseDir) {
            void (0, persist_io_1.writeMeasuredConsumersPersist)(baseDir, persist).catch(() => undefined);
        }
    }
    hostRef = null;
}
exports.stopMeasuredConsumersRuntimeEngine = stopMeasuredConsumersRuntimeEngine;
/** Für Tests: Engine-Zustand zurücksetzen. */
function resetMeasuredConsumersEngineForTest() {
    engineActive = false;
    clearTick();
    hostRef = null;
    persist = (0, persist_1.emptyMeasuredConsumersPersist)();
    persistHydrated = false;
    overflowWarned = false;
}
exports.resetMeasuredConsumersEngineForTest = resetMeasuredConsumersEngineForTest;
