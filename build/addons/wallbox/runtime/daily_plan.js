"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveWallboxDailyPlanDecision = exports.evaluateWallboxDailyPlan = exports.resolveWallboxPlanExecutionStatus = exports.summarizeWallboxPlanUntilDeadline = exports.resolveWallboxPowerLimits = exports.parseDailyAllocationEntries = exports.computeRemainingEnergyKwh = exports.telemetryInputFromSnapshot = exports.wallboxMinChargePowerW = exports.resetWallboxDailyPlanCache = exports.WALLBOX_PLAN_POWER_TOLERANCE_W = void 0;
const contribution_ids_1 = require("../../../operator/contribution_ids");
const states_1 = require("../../../operator/daily_plan/states");
const slots_1 = require("../../../operator/daily_plan/slots");
const time_1 = require("../../../operator/time");
const config_1 = require("../../../intent/config");
const types_1 = require("../../../operator/contributions/flexible/types");
const WALLBOX_CONTRIBUTION_ID = contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION;
const ACTIVE_ALLOCATION_STATUSES = new Set(["allocated", "partially_allocated"]);
const USABLE_DAILY_PLAN_STATUSES = new Set(["ready", "degraded"]);
const SLOT_HOURS = (0, slots_1.slotDurationHours)(15);
/** Abweichungstoleranz zwischen geplanter und tatsächlicher Ladeleistung (W). */
exports.WALLBOX_PLAN_POWER_TOLERANCE_W = 300;
let planCache = null;
function resetWallboxDailyPlanCache() {
    planCache = null;
}
exports.resetWallboxDailyPlanCache = resetWallboxDailyPlanCache;
function wallboxMinChargePowerW(phases, minCurrentA, voltage = 230) {
    if (phases === null || minCurrentA === null || phases <= 0 || minCurrentA <= 0)
        return null;
    return Math.round(phases * voltage * minCurrentA);
}
exports.wallboxMinChargePowerW = wallboxMinChargePowerW;
function telemetryInputFromSnapshot(snap, cfg) {
    const pickBool = (f) => f.status === "valid" ? f.value : null;
    const pickNum = (f) => f.status === "valid" ? f.value : null;
    const pickStr = (f) => f.status === "valid" ? f.value : null;
    return {
        connected: pickBool(snap.connected),
        charging: pickBool(snap.charging),
        vehicleSocPct: pickNum(snap.vehicle_soc_pct),
        planSocPct: pickNum(snap.plan_soc_pct),
        planActive: pickBool(snap.plan_active),
        sessionEnergyKwh: pickNum(snap.session_energy_kwh),
        effectivePlanTime: pickStr(snap.effective_plan_time),
        planTime: pickStr(snap.plan_time),
        activePhases: pickNum(snap.active_phases),
        configuredPhases: pickNum(snap.configured_phases),
        minCurrentA: pickNum(snap.min_current_a),
        maxCurrentA: pickNum(snap.max_current_a),
        chargePowerW: pickNum(snap.charge_power_w),
        evccConfigured: cfg.enabledStateId.trim().length > 0,
        mappingsReady: cfg.enabledStateId.trim().length > 0 && cfg.connectedStateId.trim().length > 0,
    };
}
exports.telemetryInputFromSnapshot = telemetryInputFromSnapshot;
function computeRemainingEnergyKwh(telemetry, vehicleCapacityKwh = null) {
    if (vehicleCapacityKwh !== null && vehicleCapacityKwh > 0) {
        const targetSoc = telemetry.planActive && telemetry.planSocPct !== null ? telemetry.planSocPct : telemetry.planSocPct;
        if (targetSoc !== null && telemetry.vehicleSocPct !== null) {
            const delta = targetSoc - telemetry.vehicleSocPct;
            if (delta <= 0)
                return 0;
            return (0, types_1.round3)((delta / 100) * vehicleCapacityKwh);
        }
    }
    return null;
}
exports.computeRemainingEnergyKwh = computeRemainingEnergyKwh;
function isValidTimezone(timezone) {
    if (!timezone.trim())
        return false;
    try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
        return true;
    }
    catch {
        return false;
    }
}
function parseJson(raw) {
    if (!raw || !raw.trim())
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
function isDailyAllocationEntry(v) {
    if (!v || typeof v !== "object")
        return false;
    const o = v;
    return (typeof o.contributionId === "string" &&
        o.slot !== null &&
        typeof o.slot === "object" &&
        typeof o.slot.startIso === "string" &&
        typeof o.slot.endIso === "string" &&
        typeof o.status === "string");
}
function parseDailyAllocationEntries(raw) {
    if (raw === null || raw === undefined)
        return null;
    if (typeof raw === "string") {
        if (!raw.trim())
            return null;
        try {
            raw = JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    if (!Array.isArray(raw))
        return null;
    const out = [];
    for (const item of raw) {
        if (!isDailyAllocationEntry(item))
            return null;
        out.push(item);
    }
    return out;
}
exports.parseDailyAllocationEntries = parseDailyAllocationEntries;
function parseFullDailyPlan(raw) {
    if (raw === null || raw === undefined)
        return null;
    if (typeof raw === "string") {
        if (!raw.trim())
            return null;
        try {
            raw = JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    if (!raw || typeof raw !== "object")
        return null;
    const p = raw;
    if (typeof p.date !== "string" || !Array.isArray(p.allocations))
        return null;
    return raw;
}
function wallboxEntriesFromSources(allocationEntries, fullPlan) {
    const seen = new Set();
    const out = [];
    const add = (entries) => {
        for (const e of entries) {
            if (e.contributionId !== WALLBOX_CONTRIBUTION_ID)
                continue;
            const key = `${e.contributionId}|${(0, slots_1.slotKey)(e.slot.startIso, e.slot.endIso)}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            out.push(e);
        }
    };
    if (allocationEntries)
        add(allocationEntries);
    if (fullPlan) {
        add(fullPlan.allocations.filter((a) => a.contributionId === WALLBOX_CONTRIBUTION_ID));
    }
    return out;
}
function entryEnergyKwh(entry) {
    if (entry.allocatedEnergyKwh !== null && Number.isFinite(entry.allocatedEnergyKwh)) {
        return entry.allocatedEnergyKwh;
    }
    if (entry.allocatedPowerW !== null && entry.allocatedPowerW > 0) {
        return (0, types_1.round3)((entry.allocatedPowerW * SLOT_HOURS) / 1000);
    }
    return 0;
}
function resolveWallboxPowerLimits(telemetry) {
    const phases = telemetry.activePhases ?? telemetry.configuredPhases;
    const maxW = (0, types_1.wallboxMaxChargePowerW)(phases, telemetry.maxCurrentA);
    const minW = wallboxMinChargePowerW(phases, telemetry.minCurrentA);
    if (maxW === null) {
        return {
            minChargePowerW: minW,
            maxChargePowerW: null,
            degraded: true,
            reasonDe: "Phasen- oder Stromdaten fehlen — technische Leistungsgrenze unbekannt.",
        };
    }
    return {
        minChargePowerW: minW,
        maxChargePowerW: maxW,
        degraded: false,
        reasonDe: `Technische Leistungsgrenze ${maxW} W (${phases ?? "?"} Phasen).`,
    };
}
exports.resolveWallboxPowerLimits = resolveWallboxPowerLimits;
function summarizeWallboxPlanUntilDeadline(entries, deadlineIso, nowMs) {
    const deadlineMs = deadlineIso ? Date.parse(deadlineIso) : null;
    let plannedEnergy = 0;
    let plannedPv = 0;
    let plannedGrid = 0;
    let plannedCost = null;
    let hasCost = false;
    let activeSlots = 0;
    let maxPower = 0;
    let firstSlot = null;
    let lastSlot = null;
    for (const entry of entries) {
        if (entry.contributionId !== WALLBOX_CONTRIBUTION_ID)
            continue;
        if (!ACTIVE_ALLOCATION_STATUSES.has(entry.status))
            continue;
        const startMs = Date.parse(entry.slot.startIso);
        if (!Number.isFinite(startMs) || startMs < nowMs)
            continue;
        if (deadlineMs !== null && Number.isFinite(deadlineMs) && startMs >= deadlineMs)
            continue;
        const energy = entryEnergyKwh(entry);
        plannedEnergy += energy;
        if (entry.energySource === "pv_surplus") {
            plannedPv += energy;
        }
        else if (entry.energySource === "grid") {
            plannedGrid += energy;
        }
        else if (entry.energySource === "mixed") {
            const total = entry.pvPowerW + entry.gridPowerW;
            if (total > 0) {
                plannedPv += energy * (entry.pvPowerW / total);
                plannedGrid += energy * (entry.gridPowerW / total);
            }
        }
        if (entry.estimatedCostCt !== null && Number.isFinite(entry.estimatedCostCt)) {
            plannedCost = (plannedCost ?? 0) + entry.estimatedCostCt;
            hasCost = true;
        }
        activeSlots += 1;
        if (entry.allocatedPowerW !== null) {
            maxPower = Math.max(maxPower, entry.allocatedPowerW);
        }
        if (!firstSlot || entry.slot.startIso < firstSlot)
            firstSlot = entry.slot.startIso;
        if (!lastSlot || entry.slot.startIso > lastSlot)
            lastSlot = entry.slot.startIso;
    }
    return {
        plannedEnergyUntilDeadlineKwh: (0, types_1.round3)(plannedEnergy),
        plannedPvEnergyUntilDeadlineKwh: (0, types_1.round3)(plannedPv),
        plannedGridEnergyUntilDeadlineKwh: (0, types_1.round3)(plannedGrid),
        plannedCostUntilDeadlineCt: hasCost ? (0, types_1.round3)(plannedCost ?? 0) : null,
        firstPlannedSlot: firstSlot,
        lastPlannedSlot: lastSlot,
        activePlannedSlots: activeSlots,
        maxPlannedPowerW: maxPower,
    };
}
exports.summarizeWallboxPlanUntilDeadline = summarizeWallboxPlanUntilDeadline;
function mergeCurrentSlotAllocation(entries, slotStartIso, slotEndIso) {
    const key = (0, slots_1.slotKey)(slotStartIso, slotEndIso);
    let found = null;
    for (const entry of entries) {
        if (entry.contributionId !== WALLBOX_CONTRIBUTION_ID)
            continue;
        if ((0, slots_1.slotKey)(entry.slot.startIso, entry.slot.endIso) !== key)
            continue;
        if (found) {
            return { valid: false, entry: null, reasonDe: "Doppelte Wallbox-Allocation im selben Slot." };
        }
        found = entry;
    }
    return { valid: true, entry: found, reasonDe: "" };
}
function planExecutionStatus(connected, charging, chargingAllowedByPlan, allocatedPowerW, chargePowerW = null) {
    if (!connected)
        return "vehicle_disconnected";
    if (charging === true) {
        if (chargingAllowedByPlan && (allocatedPowerW ?? 0) > 0) {
            if (chargePowerW !== null && allocatedPowerW !== null) {
                if (chargePowerW < allocatedPowerW - exports.WALLBOX_PLAN_POWER_TOLERANCE_W) {
                    return "charging_below_plan";
                }
                if (chargePowerW > allocatedPowerW + exports.WALLBOX_PLAN_POWER_TOLERANCE_W) {
                    return "charging_above_plan";
                }
            }
            return "in_plan";
        }
        return "charging_without_plan";
    }
    if (charging === false) {
        if (chargingAllowedByPlan && (allocatedPowerW ?? 0) > 0)
            return "planned_but_not_charging";
        return "not_planned_not_charging";
    }
    return "unknown";
}
function resolveWallboxPlanExecutionStatus(connected, charging, chargingAllowedByPlan, allocatedPowerW, chargePowerW = null) {
    return planExecutionStatus(connected, charging, chargingAllowedByPlan, allocatedPowerW, chargePowerW);
}
exports.resolveWallboxPlanExecutionStatus = resolveWallboxPlanExecutionStatus;
function disconnectedDecision(telemetry) {
    return {
        connected: false,
        planValid: false,
        useDailyPlan: false,
        chargingAllowedByPlan: false,
        dailyPlanStatus: "daily_plan_missing",
        dailyPlanRevision: null,
        slotStartIso: null,
        slotEndIso: null,
        allocatedPowerW: null,
        allocatedEnergyKwh: null,
        requestedPowerW: null,
        requestedEnergyKwh: null,
        pvPowerW: null,
        gridPowerW: null,
        energySource: "none",
        deadlineIso: null,
        estimatedCostCt: null,
        remainingEnergyKwh: null,
        minChargePowerW: null,
        maxChargePowerW: null,
        plannedEnergyUntilDeadlineKwh: 0,
        plannedPvEnergyUntilDeadlineKwh: 0,
        plannedGridEnergyUntilDeadlineKwh: 0,
        plannedCostUntilDeadlineCt: null,
        deadlineReachable: null,
        firstPlannedSlot: null,
        lastPlannedSlot: null,
        activePlannedSlots: 0,
        maxPlannedPowerW: 0,
        planExecutionStatus: "vehicle_disconnected",
        decisionSource: "vehicle_disconnected",
        reasonDe: "Fahrzeug ist nicht verbunden; es wird keine Ladeaktion geplant.",
        externalPlanActive: telemetry.planActive === true,
        externalPlanTime: telemetry.effectivePlanTime ?? telemetry.planTime,
        runtimeControlAvailable: false,
        writeAllowed: false,
    };
}
function evaluateWallboxDailyPlan(input) {
    const { now, timezone, meta, entries, telemetry, governanceEnabled, addonEnabled } = input;
    const nowMs = now.getTime();
    const powerLimits = resolveWallboxPowerLimits(telemetry);
    const externalPlanActive = telemetry.planActive === true;
    const externalPlanTime = telemetry.effectivePlanTime ?? telemetry.planTime;
    if (!addonEnabled) {
        return {
            ...disconnectedDecision({ ...telemetry, connected: false }),
            decisionSource: "addon_disabled",
            reasonDe: "Wallbox-Add-on deaktiviert — keine Planfreigabe.",
            externalPlanActive,
            externalPlanTime,
        };
    }
    if (!telemetry.mappingsReady) {
        return {
            ...disconnectedDecision({ ...telemetry, connected: telemetry.connected }),
            decisionSource: "mapping_incomplete",
            reasonDe: "EVCC-Mapping unvollständig — keine Ladefreigabe.",
            minChargePowerW: powerLimits.minChargePowerW,
            maxChargePowerW: powerLimits.maxChargePowerW,
            externalPlanActive,
            externalPlanTime,
        };
    }
    if (telemetry.connected === null) {
        return {
            ...disconnectedDecision({ ...telemetry, connected: false }),
            decisionSource: "missing_telemetry",
            reasonDe: "Verbindungsstatus unbekannt — keine Ladefreigabe.",
            externalPlanActive,
            externalPlanTime,
        };
    }
    if (telemetry.connected === false) {
        return disconnectedDecision(telemetry);
    }
    if (!governanceEnabled) {
        const remaining = null;
        return {
            connected: true,
            planValid: false,
            useDailyPlan: false,
            chargingAllowedByPlan: false,
            dailyPlanStatus: "daily_plan_missing",
            dailyPlanRevision: meta.revision,
            slotStartIso: null,
            slotEndIso: null,
            allocatedPowerW: null,
            allocatedEnergyKwh: null,
            requestedPowerW: null,
            requestedEnergyKwh: null,
            pvPowerW: null,
            gridPowerW: null,
            energySource: "none",
            deadlineIso: telemetry.effectivePlanTime,
            estimatedCostCt: null,
            remainingEnergyKwh: remaining,
            minChargePowerW: powerLimits.minChargePowerW,
            maxChargePowerW: powerLimits.maxChargePowerW,
            plannedEnergyUntilDeadlineKwh: 0,
            plannedPvEnergyUntilDeadlineKwh: 0,
            plannedGridEnergyUntilDeadlineKwh: 0,
            plannedCostUntilDeadlineCt: null,
            deadlineReachable: null,
            firstPlannedSlot: null,
            lastPlannedSlot: null,
            activePlannedSlots: 0,
            maxPlannedPowerW: 0,
            planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
            decisionSource: "governance_disabled",
            reasonDe: "Wallbox-Governance deaktiviert — keine aktive Planfreigabe.",
            externalPlanActive,
            externalPlanTime,
            runtimeControlAvailable: false,
            writeAllowed: false,
        };
    }
    const remainingEnergyKwh = computeRemainingEnergyKwh(telemetry, input.vehicleCapacityKwh ?? null);
    const deadlineIso = telemetry.effectivePlanTime;
    const horizon = summarizeWallboxPlanUntilDeadline(entries, deadlineIso, nowMs);
    let deadlineReachable = null;
    if (remainingEnergyKwh !== null && horizon.plannedEnergyUntilDeadlineKwh > 0) {
        deadlineReachable = horizon.plannedEnergyUntilDeadlineKwh >= remainingEnergyKwh;
    }
    else if (remainingEnergyKwh !== null && horizon.plannedEnergyUntilDeadlineKwh === 0) {
        deadlineReachable = remainingEnergyKwh <= 0;
    }
    if (!meta.status || meta.status === "not_initialized") {
        const decisionSource = externalPlanActive ? "external_plan_only" : "no_plan";
        return {
            connected: true,
            planValid: false,
            useDailyPlan: false,
            chargingAllowedByPlan: false,
            dailyPlanStatus: "daily_plan_missing",
            dailyPlanRevision: meta.revision,
            slotStartIso: null,
            slotEndIso: null,
            allocatedPowerW: null,
            allocatedEnergyKwh: null,
            requestedPowerW: null,
            requestedEnergyKwh: null,
            pvPowerW: null,
            gridPowerW: null,
            energySource: "none",
            deadlineIso,
            estimatedCostCt: null,
            remainingEnergyKwh,
            minChargePowerW: powerLimits.minChargePowerW,
            maxChargePowerW: powerLimits.maxChargePowerW,
            plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
            plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
            plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
            plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
            deadlineReachable,
            firstPlannedSlot: horizon.firstPlannedSlot,
            lastPlannedSlot: horizon.lastPlannedSlot,
            activePlannedSlots: horizon.activePlannedSlots,
            maxPlannedPowerW: horizon.maxPlannedPowerW,
            planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
            decisionSource,
            reasonDe: decisionSource === "external_plan_only"
                ? "Kein gültiger EMS Daily Plan — externer EVCC-Plan nur diagnostisch."
                : "Daily Plan fehlt — Wallbox bleibt read-only.",
            externalPlanActive,
            externalPlanTime,
            runtimeControlAvailable: false,
            writeAllowed: false,
        };
    }
    if (!USABLE_DAILY_PLAN_STATUSES.has(meta.status)) {
        return {
            connected: true,
            planValid: false,
            useDailyPlan: false,
            chargingAllowedByPlan: false,
            dailyPlanStatus: "daily_plan_invalid",
            dailyPlanRevision: meta.revision,
            slotStartIso: null,
            slotEndIso: null,
            allocatedPowerW: null,
            allocatedEnergyKwh: null,
            requestedPowerW: null,
            requestedEnergyKwh: null,
            pvPowerW: null,
            gridPowerW: null,
            energySource: "none",
            deadlineIso,
            estimatedCostCt: null,
            remainingEnergyKwh,
            minChargePowerW: powerLimits.minChargePowerW,
            maxChargePowerW: powerLimits.maxChargePowerW,
            plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
            plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
            plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
            plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
            deadlineReachable,
            firstPlannedSlot: horizon.firstPlannedSlot,
            lastPlannedSlot: horizon.lastPlannedSlot,
            activePlannedSlots: horizon.activePlannedSlots,
            maxPlannedPowerW: horizon.maxPlannedPowerW,
            planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
            decisionSource: "invalid_plan",
            reasonDe: `Daily Plan Status „${meta.status}“ ungültig — keine EMS-Ladefreigabe.`,
            externalPlanActive,
            externalPlanTime,
            runtimeControlAvailable: false,
            writeAllowed: false,
        };
    }
    if (!isValidTimezone(timezone)) {
        return {
            connected: true,
            planValid: false,
            useDailyPlan: false,
            chargingAllowedByPlan: false,
            dailyPlanStatus: "daily_plan_invalid",
            dailyPlanRevision: meta.revision,
            slotStartIso: null,
            slotEndIso: null,
            allocatedPowerW: null,
            allocatedEnergyKwh: null,
            requestedPowerW: null,
            requestedEnergyKwh: null,
            pvPowerW: null,
            gridPowerW: null,
            energySource: "none",
            deadlineIso,
            estimatedCostCt: null,
            remainingEnergyKwh,
            minChargePowerW: powerLimits.minChargePowerW,
            maxChargePowerW: powerLimits.maxChargePowerW,
            plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
            plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
            plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
            plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
            deadlineReachable,
            firstPlannedSlot: horizon.firstPlannedSlot,
            lastPlannedSlot: horizon.lastPlannedSlot,
            activePlannedSlots: horizon.activePlannedSlots,
            maxPlannedPowerW: horizon.maxPlannedPowerW,
            planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
            decisionSource: "invalid_plan",
            reasonDe: "Zeitzone ungültig — Daily Plan nicht verwendbar.",
            externalPlanActive,
            externalPlanTime,
            runtimeControlAvailable: false,
            writeAllowed: false,
        };
    }
    const localDate = (0, time_1.localDateKeyInTimezone)(now, timezone);
    if (meta.date !== localDate) {
        return {
            connected: true,
            planValid: false,
            useDailyPlan: false,
            chargingAllowedByPlan: false,
            dailyPlanStatus: "daily_plan_wrong_date",
            dailyPlanRevision: meta.revision,
            slotStartIso: null,
            slotEndIso: null,
            allocatedPowerW: null,
            allocatedEnergyKwh: null,
            requestedPowerW: null,
            requestedEnergyKwh: null,
            pvPowerW: null,
            gridPowerW: null,
            energySource: "none",
            deadlineIso,
            estimatedCostCt: null,
            remainingEnergyKwh,
            minChargePowerW: powerLimits.minChargePowerW,
            maxChargePowerW: powerLimits.maxChargePowerW,
            plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
            plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
            plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
            plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
            deadlineReachable,
            firstPlannedSlot: horizon.firstPlannedSlot,
            lastPlannedSlot: horizon.lastPlannedSlot,
            activePlannedSlots: horizon.activePlannedSlots,
            maxPlannedPowerW: horizon.maxPlannedPowerW,
            planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
            decisionSource: "invalid_plan",
            reasonDe: `Daily Plan Datum (${meta.date}) passt nicht zum lokalen Tag (${localDate}).`,
            externalPlanActive,
            externalPlanTime,
            runtimeControlAvailable: false,
            writeAllowed: false,
        };
    }
    if (meta.validUntil) {
        const validUntilMs = Date.parse(meta.validUntil);
        if (!Number.isFinite(validUntilMs) || nowMs > validUntilMs) {
            return {
                connected: true,
                planValid: false,
                useDailyPlan: false,
                chargingAllowedByPlan: false,
                dailyPlanStatus: "daily_plan_expired",
                dailyPlanRevision: meta.revision,
                slotStartIso: null,
                slotEndIso: null,
                allocatedPowerW: null,
                allocatedEnergyKwh: null,
                requestedPowerW: null,
                requestedEnergyKwh: null,
                pvPowerW: null,
                gridPowerW: null,
                energySource: "none",
                deadlineIso,
                estimatedCostCt: null,
                remainingEnergyKwh,
                minChargePowerW: powerLimits.minChargePowerW,
                maxChargePowerW: powerLimits.maxChargePowerW,
                plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
                plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
                plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
                plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
                deadlineReachable,
                firstPlannedSlot: horizon.firstPlannedSlot,
                lastPlannedSlot: horizon.lastPlannedSlot,
                activePlannedSlots: horizon.activePlannedSlots,
                maxPlannedPowerW: horizon.maxPlannedPowerW,
                planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
                decisionSource: "invalid_plan",
                reasonDe: "Daily Plan abgelaufen — keine EMS-Ladefreigabe.",
                externalPlanActive,
                externalPlanTime,
                runtimeControlAvailable: false,
                writeAllowed: false,
            };
        }
    }
    const slotStartIso = (0, slots_1.slotStartIsoFloored)(now, timezone);
    if (!(0, time_1.isValidIsoTimestamp)(slotStartIso)) {
        return {
            connected: true,
            planValid: false,
            useDailyPlan: false,
            chargingAllowedByPlan: false,
            dailyPlanStatus: "daily_plan_slot_missing",
            dailyPlanRevision: meta.revision,
            slotStartIso: null,
            slotEndIso: null,
            allocatedPowerW: null,
            allocatedEnergyKwh: null,
            requestedPowerW: null,
            requestedEnergyKwh: null,
            pvPowerW: null,
            gridPowerW: null,
            energySource: "none",
            deadlineIso,
            estimatedCostCt: null,
            remainingEnergyKwh,
            minChargePowerW: powerLimits.minChargePowerW,
            maxChargePowerW: powerLimits.maxChargePowerW,
            plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
            plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
            plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
            plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
            deadlineReachable,
            firstPlannedSlot: horizon.firstPlannedSlot,
            lastPlannedSlot: horizon.lastPlannedSlot,
            activePlannedSlots: horizon.activePlannedSlots,
            maxPlannedPowerW: horizon.maxPlannedPowerW,
            planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
            decisionSource: "invalid_plan",
            reasonDe: "Aktueller Daily-Plan-Slot nicht bestimmbar.",
            externalPlanActive,
            externalPlanTime,
            runtimeControlAvailable: false,
            writeAllowed: false,
        };
    }
    const slotStartMs = Date.parse(slotStartIso);
    const slotEndIso = (0, time_1.isoFromMs)(slotStartMs + slots_1.DAILY_PLAN_SLOT_MS);
    const slotMerge = mergeCurrentSlotAllocation(entries, slotStartIso, slotEndIso);
    if (!slotMerge.valid) {
        return {
            connected: true,
            planValid: false,
            useDailyPlan: false,
            chargingAllowedByPlan: false,
            dailyPlanStatus: "daily_plan_allocation_invalid",
            dailyPlanRevision: meta.revision,
            slotStartIso,
            slotEndIso,
            allocatedPowerW: null,
            allocatedEnergyKwh: null,
            requestedPowerW: null,
            requestedEnergyKwh: null,
            pvPowerW: null,
            gridPowerW: null,
            energySource: "none",
            deadlineIso,
            estimatedCostCt: null,
            remainingEnergyKwh,
            minChargePowerW: powerLimits.minChargePowerW,
            maxChargePowerW: powerLimits.maxChargePowerW,
            plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
            plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
            plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
            plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
            deadlineReachable,
            firstPlannedSlot: horizon.firstPlannedSlot,
            lastPlannedSlot: horizon.lastPlannedSlot,
            activePlannedSlots: horizon.activePlannedSlots,
            maxPlannedPowerW: horizon.maxPlannedPowerW,
            planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
            decisionSource: "invalid_plan",
            reasonDe: slotMerge.reasonDe,
            externalPlanActive,
            externalPlanTime,
            runtimeControlAvailable: false,
            writeAllowed: false,
        };
    }
    const entry = slotMerge.entry;
    let allocatedPowerW = null;
    let allocatedEnergyKwh = null;
    let requestedPowerW = null;
    let requestedEnergyKwh = null;
    let pvPowerW = null;
    let gridPowerW = null;
    let energySource = "none";
    let estimatedCostCt = null;
    let dailyPlanStatus = "daily_plan_zero_allocation";
    let chargingAllowedByPlan = false;
    let reasonDe = "Daily Plan: im aktuellen Slot keine Wallbox-Ladefreigabe (0 W).";
    if (entry && ACTIVE_ALLOCATION_STATUSES.has(entry.status)) {
        if (entry.allocatedPowerW === null || !Number.isFinite(entry.allocatedPowerW) || entry.allocatedPowerW < 0) {
            return {
                connected: true,
                planValid: true,
                useDailyPlan: true,
                chargingAllowedByPlan: false,
                dailyPlanStatus: "daily_plan_allocation_invalid",
                dailyPlanRevision: meta.revision,
                slotStartIso,
                slotEndIso,
                allocatedPowerW: null,
                allocatedEnergyKwh: null,
                requestedPowerW: entry.requestedPowerW,
                requestedEnergyKwh: entry.requestedEnergyKwh,
                pvPowerW: null,
                gridPowerW: null,
                energySource: "none",
                deadlineIso: entry.deadlineIso ?? deadlineIso,
                estimatedCostCt: null,
                remainingEnergyKwh,
                minChargePowerW: powerLimits.minChargePowerW,
                maxChargePowerW: powerLimits.maxChargePowerW,
                plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
                plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
                plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
                plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
                deadlineReachable,
                firstPlannedSlot: horizon.firstPlannedSlot,
                lastPlannedSlot: horizon.lastPlannedSlot,
                activePlannedSlots: horizon.activePlannedSlots,
                maxPlannedPowerW: horizon.maxPlannedPowerW,
                planExecutionStatus: planExecutionStatus(true, telemetry.charging, false, null),
                decisionSource: "invalid_plan",
                reasonDe: "Ungültige Wallbox-Allocation-Leistung.",
                externalPlanActive,
                externalPlanTime,
                runtimeControlAvailable: false,
                writeAllowed: false,
            };
        }
        allocatedPowerW = entry.allocatedPowerW;
        if (powerLimits.maxChargePowerW !== null && allocatedPowerW > powerLimits.maxChargePowerW) {
            allocatedPowerW = powerLimits.maxChargePowerW;
        }
        allocatedEnergyKwh = entry.allocatedEnergyKwh;
        requestedPowerW = entry.requestedPowerW;
        requestedEnergyKwh = entry.requestedEnergyKwh;
        pvPowerW = entry.pvPowerW;
        gridPowerW = entry.gridPowerW;
        energySource = entry.energySource;
        estimatedCostCt = entry.estimatedCostCt;
        dailyPlanStatus = allocatedPowerW > 0 ? "daily_plan_valid" : "daily_plan_zero_allocation";
        if (powerLimits.degraded) {
            dailyPlanStatus = "power_limits_unknown";
            chargingAllowedByPlan = false;
            reasonDe = powerLimits.reasonDe;
        }
        else if (allocatedPowerW <= 0) {
            chargingAllowedByPlan = false;
            reasonDe = "Daily Plan: keine Ladefreigabe im aktuellen Slot.";
        }
        else if (powerLimits.minChargePowerW !== null &&
            allocatedPowerW < powerLimits.minChargePowerW) {
            dailyPlanStatus = "allocation_below_min_power";
            chargingAllowedByPlan = false;
            reasonDe = `Allozierte Leistung ${allocatedPowerW} W liegt unter der technischen Mindestladeleistung ${powerLimits.minChargePowerW} W.`;
        }
        else {
            chargingAllowedByPlan = true;
            reasonDe = `Daily Plan sieht ${allocatedPowerW} W Ladeleistung vor; Wallbox-Steuerung ist noch read-only.`;
        }
    }
    const decisionSource = allocatedPowerW !== null && allocatedPowerW > 0 && chargingAllowedByPlan
        ? "daily_plan"
        : allocatedPowerW !== null && allocatedPowerW === 0
            ? "daily_plan_zero"
            : chargingAllowedByPlan
                ? "daily_plan"
                : "daily_plan_zero";
    if (telemetry.charging && !chargingAllowedByPlan) {
        reasonDe = `Fahrzeug lädt aktuell${externalPlanActive ? " über EVCC" : ""}; EMS Daily Plan enthält im Slot keine Ladefreigabe.`;
    }
    else if (telemetry.charging && chargingAllowedByPlan) {
        reasonDe = `Fahrzeug lädt aktuell${externalPlanActive ? " über EVCC" : ""}; EMS Daily Plan sieht ${allocatedPowerW} W vor (read-only).`;
    }
    return {
        connected: true,
        planValid: true,
        useDailyPlan: true,
        chargingAllowedByPlan,
        dailyPlanStatus,
        dailyPlanRevision: meta.revision,
        slotStartIso,
        slotEndIso,
        allocatedPowerW,
        allocatedEnergyKwh,
        requestedPowerW,
        requestedEnergyKwh,
        pvPowerW,
        gridPowerW,
        energySource,
        deadlineIso: entry?.deadlineIso ?? deadlineIso,
        estimatedCostCt,
        remainingEnergyKwh,
        minChargePowerW: powerLimits.minChargePowerW,
        maxChargePowerW: powerLimits.maxChargePowerW,
        plannedEnergyUntilDeadlineKwh: horizon.plannedEnergyUntilDeadlineKwh,
        plannedPvEnergyUntilDeadlineKwh: horizon.plannedPvEnergyUntilDeadlineKwh,
        plannedGridEnergyUntilDeadlineKwh: horizon.plannedGridEnergyUntilDeadlineKwh,
        plannedCostUntilDeadlineCt: horizon.plannedCostUntilDeadlineCt,
        deadlineReachable,
        firstPlannedSlot: horizon.firstPlannedSlot,
        lastPlannedSlot: horizon.lastPlannedSlot,
        activePlannedSlots: horizon.activePlannedSlots,
        maxPlannedPowerW: horizon.maxPlannedPowerW,
        planExecutionStatus: planExecutionStatus(true, telemetry.charging, chargingAllowedByPlan, allocatedPowerW, telemetry.chargePowerW),
        decisionSource,
        reasonDe,
        externalPlanActive,
        externalPlanTime,
        runtimeControlAvailable: false,
        writeAllowed: false,
    };
}
exports.evaluateWallboxDailyPlan = evaluateWallboxDailyPlan;
async function readStr(host, id) {
    try {
        const st = await host.getStateAsync(id);
        if (st?.val === null || st?.val === undefined)
            return null;
        return String(st.val);
    }
    catch {
        return null;
    }
}
async function readNum(host, id) {
    const raw = await readStr(host, id);
    if (raw === null || raw === "")
        return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
}
async function loadPlanData(host) {
    const adminCfg = (0, config_1.intentAdminConfigFromAdapter)(host.config);
    const timezone = adminCfg.timezone || "Europe/Berlin";
    const status = (await readStr(host, states_1.DAILY_PLAN_STATE_IDS.status)) ?? "";
    const date = (await readStr(host, states_1.DAILY_PLAN_STATE_IDS.date)) ?? "";
    const revision = (await readNum(host, states_1.DAILY_PLAN_STATE_IDS.revision)) ?? 0;
    const validUntilRaw = await readStr(host, states_1.DAILY_PLAN_STATE_IDS.validUntil);
    const validUntil = validUntilRaw && validUntilRaw.trim() ? validUntilRaw : null;
    const meta = { status, date, revision, validUntil, timezone };
    if (planCache && planCache.revision === revision && !planCache.parseError) {
        return { meta, entries: planCache.entries, parseError: false };
    }
    const allocationRaw = parseJson(await readStr(host, states_1.ALLOCATION_ADDON_STATE_IDS.wallbox.planJson));
    const allocationEntries = parseDailyAllocationEntries(allocationRaw);
    const fullPlanRaw = parseJson(await readStr(host, states_1.DAILY_PLAN_STATE_IDS.planJson));
    const fullPlan = parseFullDailyPlan(fullPlanRaw);
    const parseError = allocationRaw === undefined || (allocationEntries === null && allocationRaw !== null);
    if (parseError) {
        planCache = { revision, entries: [], fullPlan: null, parseError: true };
        return { meta, entries: [], parseError: true };
    }
    const entries = wallboxEntriesFromSources(allocationEntries, fullPlan);
    planCache = { revision, entries, fullPlan, parseError: false };
    return { meta, entries, parseError: false };
}
async function resolveWallboxDailyPlanDecision(host, snap, cfg, now, opts) {
    const telemetry = telemetryInputFromSnapshot(snap, cfg);
    const { meta, entries, parseError } = await loadPlanData(host);
    if (parseError) {
        return evaluateWallboxDailyPlan({
            now,
            timezone: meta.timezone,
            meta: { ...meta, status: "error" },
            entries: [],
            telemetry,
            governanceEnabled: opts.governanceEnabled,
            addonEnabled: opts.addonEnabled,
            vehicleCapacityKwh: opts.vehicleCapacityKwh,
        });
    }
    return evaluateWallboxDailyPlan({
        now,
        timezone: meta.timezone,
        meta,
        entries,
        telemetry,
        governanceEnabled: opts.governanceEnabled,
        addonEnabled: opts.addonEnabled,
        vehicleCapacityKwh: opts.vehicleCapacityKwh,
    });
}
exports.resolveWallboxDailyPlanDecision = resolveWallboxDailyPlanDecision;
