"use strict";
/**
 * Tages-Telemetrie Recorder — Tick + Replan-Hook.
 * Beeinflusst Steuerung nicht; Fehler werden isoliert.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAY_TELEMETRY_PERSIST_CATEGORY = exports.noteDayTelemetryPlanPublished = exports.tickDayTelemetry = exports.__resetDayTelemetryRuntimeForTest = void 0;
const state_util_1 = require("../../ems_light/state_util");
const config_1 = require("../../intent/config");
const time_1 = require("../../operator/time");
const types_1 = require("../../addons/immersion_heater/runtime/types");
const constants_1 = require("./constants");
Object.defineProperty(exports, "DAY_TELEMETRY_PERSIST_CATEGORY", { enumerable: true, get: function () { return constants_1.DAY_TELEMETRY_CATEGORY; } });
const energy_integrate_1 = require("./energy_integrate");
const knowledge_snapshot_1 = require("./knowledge_snapshot");
const climate_segments_1 = require("./climate_segments");
const planned_freeze_1 = require("./planned_freeze");
const persist_1 = require("./persist");
const quality_mask_1 = require("./quality_mask");
const slots_1 = require("./slots");
const sources_1 = require("./sources");
const types_2 = require("./types");
let mem = emptyMem();
let storeCache = null;
let storeDir = null;
function emptyMem() {
    return {
        lastSampleTs: null,
        baselines: { gridImport: null, gridExport: null },
        openClimate: null,
        currentPlan: null,
        currentInput: null,
        sharedGroupMap: null,
        lastSnapshotId: null,
        lastEvConnected: null,
        dirty: false,
    };
}
/** Nur Tests. */
function __resetDayTelemetryRuntimeForTest() {
    mem = emptyMem();
    storeCache = null;
    storeDir = null;
}
exports.__resetDayTelemetryRuntimeForTest = __resetDayTelemetryRuntimeForTest;
async function publishStatus(host, id, val) {
    try {
        const cur = await host.getStateAsync(id);
        if (cur?.val === val)
            return;
        await host.setStateAsync(id, { val, ack: true });
    }
    catch {
        /* Status-States sind best-effort */
    }
}
function baseDir(host) {
    if (typeof host.getAbsolutePath !== "function")
        return null;
    return host.getAbsolutePath(constants_1.DAY_TELEMETRY_CATEGORY);
}
async function loadStore(host) {
    const dir = baseDir(host);
    if (storeCache && storeDir === dir)
        return storeCache;
    storeDir = dir;
    storeCache = await (0, persist_1.loadOrEmptyDayTelemetryStore)(dir);
    return storeCache;
}
async function persistStore(host, store, dateKey) {
    const dir = baseDir(host);
    if (!dir)
        return;
    const pruned = (0, persist_1.pruneDayTelemetryStore)(store, constants_1.DAY_TELEMETRY_RETENTION_DAYS, dateKey);
    pruned.updatedAtIso = new Date().toISOString();
    await (0, persist_1.writeDayTelemetryPersist)(dir, pruned);
    storeCache = pruned;
    mem.dirty = false;
}
function ensureDay(store, dateKey, timezone) {
    const layout = (0, slots_1.buildDaySlotLayout)(dateKey, timezone);
    let day = store.days[dateKey];
    if (!day || day.slotCount !== layout.slotCount || day.startMs !== layout.startMs) {
        day = (0, types_2.emptyDayRecord)(dateKey, timezone, layout.startMs, layout.endMs, layout.slotCount);
        store = {
            ...store,
            days: { ...store.days, [dateKey]: day },
        };
    }
    return { store, day, layout };
}
function markDomain(day, slotIndex, domain, quality) {
    const prev = day.buckets.qualityMask[slotIndex] ?? 0;
    day.buckets.qualityMask[slotIndex] = (0, quality_mask_1.encodeDomainQuality)(prev, domain, quality);
}
function setLastValue(arr, index, v) {
    if (index < 0 || index >= arr.length)
        return;
    if (v === null || !Number.isFinite(v))
        return;
    arr[index] = v;
}
function addRuntimeSec(arr, index, sec) {
    if (index < 0 || index >= arr.length || !(sec > 0))
        return;
    const prev = arr[index];
    arr[index] = (prev ?? 0) + sec;
}
function freezeSlotIfNeeded(day, layout, slotIndex) {
    if (day.buckets.plannedConsumersRef[slotIndex] != null)
        return;
    const plan = mem.currentPlan;
    if (!plan) {
        markDomain(day, slotIndex, quality_mask_1.TELEMETRY_DOMAIN.PLANNER, quality_mask_1.DOMAIN_QUALITY.missing);
        return;
    }
    const slot = layout.slots[slotIndex];
    if (!slot)
        return;
    const startIso = (0, time_1.isoFromMs)(slot.startMs);
    const frozen = (0, planned_freeze_1.freezePlannedConsumersForSlot)(plan.allocations, startIso, mem.sharedGroupMap);
    const dedup = (0, planned_freeze_1.dedupePlannedConsumers)(day.plannedConsumers, frozen);
    day.plannedConsumers = dedup.table;
    day.buckets.plannedConsumersRef[slotIndex] = dedup.index;
    day.buckets.snapshotIdRef[slotIndex] = mem.lastSnapshotId;
    markDomain(day, slotIndex, quality_mask_1.TELEMETRY_DOMAIN.PLANNER, quality_mask_1.DOMAIN_QUALITY.ok);
}
function integratePowerDomain(day, layout, fromMs, toMs, powerW, bucket, domain) {
    if (powerW === null || !Number.isFinite(powerW)) {
        const idxs = overlappingSlotIndicesSafe(layout, fromMs, toMs);
        for (const i of idxs) {
            const q = (0, quality_mask_1.decodeDomainQuality)(day.buckets.qualityMask[i] ?? 0, domain);
            if (bucket[i] === null && q !== quality_mask_1.DOMAIN_QUALITY.ok) {
                markDomain(day, i, domain, quality_mask_1.DOMAIN_QUALITY.missing);
            }
        }
        return;
    }
    const shares = (0, energy_integrate_1.integratePowerAcrossSlots)(layout, fromMs, toMs, powerW);
    (0, energy_integrate_1.applySharesToBucket)(bucket, shares);
    for (const s of shares) {
        markDomain(day, s.slotIndex, domain, quality_mask_1.DOMAIN_QUALITY.ok);
    }
}
function overlappingSlotIndicesSafe(layout, fromMs, toMs) {
    const out = [];
    for (const s of layout.slots) {
        if (s.endMs <= fromMs || s.startMs >= toMs)
            continue;
        out.push(s.index);
    }
    return out;
}
function markGapMissing(day, layout, fromMs, toMs) {
    for (const i of overlappingSlotIndicesSafe(layout, fromMs, toMs)) {
        for (const d of Object.values(quality_mask_1.TELEMETRY_DOMAIN)) {
            if (d === quality_mask_1.TELEMETRY_DOMAIN.PLANNER || d === quality_mask_1.TELEMETRY_DOMAIN.PRICE)
                continue;
            const q = (0, quality_mask_1.decodeDomainQuality)(day.buckets.qualityMask[i] ?? 0, d);
            if (q === quality_mask_1.DOMAIN_QUALITY.ok)
                continue;
            markDomain(day, i, d, quality_mask_1.DOMAIN_QUALITY.missing);
        }
    }
}
/**
 * Haupt-Tick: Sample lesen, integrieren, Slot einfrieren, persistieren.
 * Fehler werden geloggt, nicht geworfen.
 */
async function tickDayTelemetry(host, now = new Date()) {
    try {
        await tickDayTelemetryInner(host, now);
    }
    catch (e) {
        host.log?.warn?.(`day_telemetry tick: ${e instanceof Error ? e.message : String(e)}`);
        await publishStatus(host, constants_1.DAY_TELEMETRY_STATES.status, "error");
    }
}
exports.tickDayTelemetry = tickDayTelemetry;
async function tickDayTelemetryInner(host, now) {
    const timezone = (0, config_1.intentAdminConfigFromAdapter)(host.config).timezone || "Europe/Berlin";
    const nowMs = now.getTime();
    const dateKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    let store = await loadStore(host);
    /* Gestern als complete markieren wenn über Mitternacht */
    const yesterday = (0, time_1.addDaysToDateKey)(dateKey, -1);
    if (store.days[yesterday] && !store.days[yesterday].complete) {
        store.days[yesterday] = { ...store.days[yesterday], complete: true };
        mem.dirty = true;
    }
    const ensured = ensureDay(store, dateKey, timezone);
    store = ensured.store;
    const day = ensured.day;
    const layout = ensured.layout;
    const sample = await (0, sources_1.readLiveTelemetrySample)(host, nowMs);
    const immersionCmd = (0, state_util_1.asNum)((await host.getStateAsync(types_1.IMMERSION_RUNTIME_STATES.commandedPowerW))?.val);
    sample.immersionRuntimeOn = (0, sources_1.immersionOnFromPowers)(sample.immersionPowerW, immersionCmd);
    const curSlot = (0, slots_1.slotIndexForMs)(layout, nowMs);
    if (curSlot != null) {
        freezeSlotIfNeeded(day, layout, curSlot);
        if (sample.priceCtPerKwh != null) {
            day.buckets.priceCtPerKwh[curSlot] = sample.priceCtPerKwh;
            markDomain(day, curSlot, quality_mask_1.TELEMETRY_DOMAIN.PRICE, quality_mask_1.DOMAIN_QUALITY.ok);
        }
        else {
            markDomain(day, curSlot, quality_mask_1.TELEMETRY_DOMAIN.PRICE, quality_mask_1.DOMAIN_QUALITY.missing);
        }
        setLastValue(day.buckets.batterySocEndPct, curSlot, sample.batterySocPct);
        setLastValue(day.buckets.evSocEndPct, curSlot, sample.evSocPct);
        setLastValue(day.buckets.boilerTempEndC, curSlot, sample.boilerTempC);
        if (sample.batterySocPct != null)
            markDomain(day, curSlot, quality_mask_1.TELEMETRY_DOMAIN.BATTERY, quality_mask_1.DOMAIN_QUALITY.ok);
        if (sample.boilerTempC != null)
            markDomain(day, curSlot, quality_mask_1.TELEMETRY_DOMAIN.THERMAL, quality_mask_1.DOMAIN_QUALITY.ok);
    }
    const gap = (0, energy_integrate_1.decideIntegrationGap)(mem.lastSampleTs, nowMs, constants_1.DAY_TELEMETRY_MAX_GAP_MS);
    if (gap.kind === "gap_too_long" && mem.lastSampleTs != null) {
        markGapMissing(day, layout, mem.lastSampleTs, nowMs);
        /* Baselines neu setzen ohne Energie zu erfinden */
        if (sample.gridImportEnergyKwh != null)
            mem.baselines.gridImport = sample.gridImportEnergyKwh;
        if (sample.gridExportEnergyKwh != null)
            mem.baselines.gridExport = sample.gridExportEnergyKwh;
    }
    else if (gap.kind === "ok") {
        const { fromMs, toMs } = gap;
        const dtSec = (toMs - fromMs) / 1000;
        integratePowerDomain(day, layout, fromMs, toMs, sample.pvPowerW, day.buckets.pvKwh, quality_mask_1.TELEMETRY_DOMAIN.PV);
        integratePowerDomain(day, layout, fromMs, toMs, sample.houseTotalPowerW, day.buckets.houseTotalKwh, quality_mask_1.TELEMETRY_DOMAIN.HOUSE);
        integratePowerDomain(day, layout, fromMs, toMs, sample.batteryChargePowerW, day.buckets.batteryChargedKwh, quality_mask_1.TELEMETRY_DOMAIN.BATTERY);
        integratePowerDomain(day, layout, fromMs, toMs, sample.batteryDischargePowerW, day.buckets.batteryDischargedKwh, quality_mask_1.TELEMETRY_DOMAIN.BATTERY);
        integratePowerDomain(day, layout, fromMs, toMs, sample.evChargePowerW, day.buckets.evChargedKwh, quality_mask_1.TELEMETRY_DOMAIN.EV);
        integratePowerDomain(day, layout, fromMs, toMs, sample.immersionPowerW, day.buckets.immersionKwh, quality_mask_1.TELEMETRY_DOMAIN.THERMAL);
        if (sample.immersionRuntimeOn === true) {
            for (const i of overlappingSlotIndicesSafe(layout, fromMs, toMs)) {
                const slot = layout.slots[i];
                const overlap = Math.min(slot.endMs, toMs) - Math.max(slot.startMs, fromMs);
                if (overlap > 0)
                    addRuntimeSec(day.buckets.immersionRuntimeSec, i, overlap / 1000);
            }
        }
        integratePowerDomain(day, layout, fromMs, toMs, sample.climateSystemPowerW, day.buckets.climateKwh, quality_mask_1.TELEMETRY_DOMAIN.CLIMATE);
        /* Shared electric: nur wenn Shared-Power aktiv / Systemleistung */
        if (sample.climateSharedPowerUsed === true || sample.climateSystemPowerW != null) {
            integratePowerDomain(day, layout, fromMs, toMs, sample.climateSystemPowerW, day.buckets.climateElecSharedKwh, quality_mask_1.TELEMETRY_DOMAIN.CLIMATE);
        }
        integratePowerDomain(day, layout, fromMs, toMs, sample.otherMeasuredConsumersPowerW, day.buckets.otherMeasuredConsumersKwh, quality_mask_1.TELEMETRY_DOMAIN.MEASURED_CONSUMERS);
        /* Grid energy counters — präzises Delta + Split */
        const imp = (0, energy_integrate_1.energyCounterDeltaPreciseKwh)(mem.baselines.gridImport, sample.gridImportEnergyKwh);
        mem.baselines.gridImport = imp.newBaseline;
        if (imp.deltaKwh != null && imp.deltaKwh > 0 && !imp.reset) {
            (0, energy_integrate_1.applySharesToBucket)(day.buckets.gridImportKwh, (0, energy_integrate_1.splitAmountAcrossSlots)(layout, fromMs, toMs, imp.deltaKwh));
            for (const s of (0, energy_integrate_1.splitAmountAcrossSlots)(layout, fromMs, toMs, imp.deltaKwh)) {
                markDomain(day, s.slotIndex, quality_mask_1.TELEMETRY_DOMAIN.GRID, quality_mask_1.DOMAIN_QUALITY.ok);
            }
        }
        else if (sample.gridImportEnergyKwh == null && sample.gridImportPowerW != null) {
            integratePowerDomain(day, layout, fromMs, toMs, sample.gridImportPowerW, day.buckets.gridImportKwh, quality_mask_1.TELEMETRY_DOMAIN.GRID);
        }
        const exp = (0, energy_integrate_1.energyCounterDeltaPreciseKwh)(mem.baselines.gridExport, sample.gridExportEnergyKwh);
        mem.baselines.gridExport = exp.newBaseline;
        if (exp.deltaKwh != null && exp.deltaKwh > 0 && !exp.reset) {
            (0, energy_integrate_1.applySharesToBucket)(day.buckets.gridExportKwh, (0, energy_integrate_1.splitAmountAcrossSlots)(layout, fromMs, toMs, exp.deltaKwh));
            for (const s of (0, energy_integrate_1.splitAmountAcrossSlots)(layout, fromMs, toMs, exp.deltaKwh)) {
                markDomain(day, s.slotIndex, quality_mask_1.TELEMETRY_DOMAIN.GRID, quality_mask_1.DOMAIN_QUALITY.ok);
            }
        }
        /* Climate run segments — nie sharedPowerGroupId="default" erfinden */
        const fromSample = (0, sources_1.resolveActiveSharedPowerGroupId)(sample.climateUnitActive, host.config, mem.sharedGroupMap);
        const sharedGroup = fromSample.groupId;
        const combo = (0, sources_1.activeUnitCombinationKey)(sample.climateUnitActive);
        const climateDelta = sample.climateSystemPowerW != null && Number.isFinite(sample.climateSystemPowerW)
            ? (sample.climateSystemPowerW * (dtSec / 3600)) / 1000
            : 0;
        const powerOk = sample.climateSystemPowerW != null &&
            Number.isFinite(sample.climateSystemPowerW) &&
            sample.climateSystemPowerW >= 0;
        const groupOk = sharedGroup != null;
        const climateValid = powerOk && groupOk && combo !== "none";
        const rejectReason = !groupOk
            ? fromSample.rejectReason ?? "shared_power_group_unknown"
            : !powerOk
                ? "invalid_power"
                : null;
        const seg = (0, climate_segments_1.advanceClimateSegment)(mem.openClimate, nowMs, {
            sharedPowerGroupId: sharedGroup,
            mode: sample.climateMode ?? "unknown",
            activeUnitCombination: combo,
            valid: climateValid,
        }, climateDelta, combo !== "none" ? dtSec : 0, rejectReason, day.climateRunSegments);
        mem.openClimate = seg.open;
        day.climateRunSegments = seg.list;
    }
    else if (gap.kind === "first_sample") {
        if (sample.gridImportEnergyKwh != null)
            mem.baselines.gridImport = sample.gridImportEnergyKwh;
        if (sample.gridExportEnergyKwh != null)
            mem.baselines.gridExport = sample.gridExportEnergyKwh;
    }
    /* Status events: EV connect/disconnect */
    if (sample.evConnected != null && mem.lastEvConnected != null && sample.evConnected !== mem.lastEvConnected) {
        day.statusEvents.push({
            tsIso: now.toISOString(),
            kind: sample.evConnected ? "ev_connected" : "ev_disconnected",
            detail: "",
        });
    }
    if (sample.evConnected != null)
        mem.lastEvConnected = sample.evConnected;
    mem.lastSampleTs = nowMs;
    mem.dirty = true;
    /* Round buckets lightly for persist stability (after accumulation) */
    roundDayBuckets(day);
    store = {
        ...store,
        days: { ...store.days, [dateKey]: day },
        updatedAtIso: now.toISOString(),
    };
    await persistStore(host, store, dateKey);
    await publishStatus(host, constants_1.DAY_TELEMETRY_STATES.status, "ok");
    if (curSlot != null) {
        const slot = layout.slots[curSlot];
        await publishStatus(host, constants_1.DAY_TELEMETRY_STATES.lastSlotWrittenAt, new Date(slot.startMs).toISOString());
    }
    await publishStatus(host, constants_1.DAY_TELEMETRY_STATES.recoveryPending, false);
}
function roundDayBuckets(day) {
    const keys = [
        "pvKwh",
        "houseTotalKwh",
        "gridImportKwh",
        "gridExportKwh",
        "batteryChargedKwh",
        "batteryDischargedKwh",
        "evChargedKwh",
        "immersionKwh",
        "climateKwh",
        "climateElecSharedKwh",
        "otherMeasuredConsumersKwh",
    ];
    for (const k of keys) {
        const arr = day.buckets[k];
        for (let i = 0; i < arr.length; i++) {
            const v = arr[i];
            if (v != null && Number.isFinite(v))
                arr[i] = (0, energy_integrate_1.roundTelemetryKwh)(v);
        }
    }
}
/**
 * Wird bei materiellem Plan-Publish aufgerufen (bestehendes REPLAN-Gate).
 */
async function noteDayTelemetryPlanPublished(input) {
    try {
        await notePlanInner(input);
    }
    catch (e) {
        input.host.log?.warn?.(`day_telemetry note plan: ${e instanceof Error ? e.message : String(e)}`);
    }
}
exports.noteDayTelemetryPlanPublished = noteDayTelemetryPlanPublished;
async function notePlanInner(input) {
    const { host, now, timezone, plan, plannerInput, replanReasons } = input;
    const dateKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    let store = await loadStore(host);
    const ensured = ensureDay(store, dateKey, timezone);
    store = ensured.store;
    const day = ensured.day;
    const layout = ensured.layout;
    mem.currentPlan = plan;
    mem.currentInput = plannerInput;
    mem.sharedGroupMap = (0, planned_freeze_1.sharedGroupMapFromClimateUnits)(plannerInput.climate?.units ?? []);
    const snapBody = (0, knowledge_snapshot_1.buildPlannerKnowledgeSnapshot)(plannerInput, now.toISOString());
    const snap = (0, knowledge_snapshot_1.withSnapshotId)(snapBody);
    const up = (0, knowledge_snapshot_1.upsertForecastSnapshot)(day.forecastSnapshots, snap);
    day.forecastSnapshots = up.list;
    mem.lastSnapshotId = up.snapshotId;
    /* Affected slot range: from current slot to end of day */
    const nowMs = now.getTime();
    const fromIdx = (0, slots_1.slotIndexForMs)(layout, nowMs) ?? 0;
    const toIdx = Math.max(0, layout.slotCount - 1);
    day.replanEvents.push({
        tsIso: now.toISOString(),
        generation: plan.generation,
        planId: plan.planId,
        reasonCodes: [...replanReasons],
        affectedSlotFrom: fromIdx,
        affectedSlotTo: toIdx,
        snapshotId: up.snapshotId,
    });
    /* Aktuellen Slot einfrieren falls noch nicht (beim Publish zur Slot-Zeit) */
    if (fromIdx != null && day.buckets.plannedConsumersRef[fromIdx] == null) {
        freezeSlotIfNeeded(day, layout, fromIdx);
    }
    store = {
        ...store,
        days: { ...store.days, [dateKey]: day },
        updatedAtIso: now.toISOString(),
    };
    await persistStore(host, store, dateKey);
}
