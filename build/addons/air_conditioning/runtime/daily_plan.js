"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acUnitContributionIds = exports.evaluateAcCoolingPermission = exports.resolveAcUnitDailyPlanAllocation = exports.resolveAcUnitDailyPlanFromData = exports.mergeUnitSlotAllocation = exports.resolveUnitExpectedPower = exports.parseDailyAllocationEntries = exports.resetAcDailyPlanCache = void 0;
const config_1 = require("../../../intent/config");
const contribution_ids_1 = require("../../../operator/contribution_ids");
const states_1 = require("../../../operator/daily_plan/states");
const slots_1 = require("../../../operator/daily_plan/slots");
const time_1 = require("../../../operator/time");
const learned_power_1 = require("../../../learning/consumer_stats/learned_power");
const constants_1 = require("../constants");
const ACTIVE_ALLOCATION_STATUSES = new Set(["allocated", "partially_allocated"]);
const USABLE_DAILY_PLAN_STATUSES = new Set(["ready", "degraded"]);
let planCache = null;
function resetAcDailyPlanCache() {
    planCache = null;
}
exports.resetAcDailyPlanCache = resetAcDailyPlanCache;
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
function acEntriesFromSources(allocationEntries, fullPlan) {
    const seen = new Set();
    const out = [];
    const add = (entries) => {
        for (const e of entries) {
            if (!e.contributionId.startsWith("air_conditioning.unit_"))
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
        add(fullPlan.allocations.filter((a) => a.contributionId.startsWith("air_conditioning.unit_")));
    }
    return out;
}
function resolveUnitExpectedPower(unit, consumerStats, nowMs) {
    const learned = (0, learned_power_1.resolveConsumerEffectivePowerW)(consumerStats, unit.estimatedPowerW, nowMs);
    return {
        ...learned,
        valid: learned.powerW > 0,
    };
}
exports.resolveUnitExpectedPower = resolveUnitExpectedPower;
function mergeUnitSlotAllocation(entries, contributionId, slotStartIso, slotEndIso) {
    const key = (0, slots_1.slotKey)(slotStartIso, slotEndIso);
    let count = 0;
    let allocatedPowerW = 0;
    const statuses = [];
    for (const entry of entries) {
        if (entry.contributionId !== contributionId)
            continue;
        if ((0, slots_1.slotKey)(entry.slot.startIso, entry.slot.endIso) !== key)
            continue;
        count += 1;
        if (count > 1) {
            return {
                allocatedPowerW: 0,
                allocationStatus: "duplicate",
                reasonDe: `Doppelte Daily-Plan-Allocation für ${contributionId}.`,
                valid: false,
            };
        }
        if (!ACTIVE_ALLOCATION_STATUSES.has(entry.status)) {
            continue;
        }
        if (entry.allocatedPowerW === null || !Number.isFinite(entry.allocatedPowerW) || entry.allocatedPowerW < 0) {
            return {
                allocatedPowerW: 0,
                allocationStatus: "invalid_power",
                reasonDe: "Ungültige Daily-Plan-Allocation-Leistung.",
                valid: false,
            };
        }
        statuses.push(entry.status);
        allocatedPowerW = entry.allocatedPowerW;
    }
    const allocationStatus = statuses.length === 0
        ? "none"
        : statuses.includes("partially_allocated")
            ? "partially_allocated"
            : "allocated";
    return {
        allocatedPowerW,
        allocationStatus,
        reasonDe: allocatedPowerW > 0
            ? `Daily Plan: ${allocatedPowerW} W für ${contributionId}.`
            : `Daily Plan: keine aktive Allocation für ${contributionId} (0 W).`,
        valid: true,
    };
}
exports.mergeUnitSlotAllocation = mergeUnitSlotAllocation;
function resolveAcUnitDailyPlanFromData(input) {
    const { unitIndex, now, timezone, meta, entries, expectedPower } = input;
    const nowMs = now.getTime();
    const contributionId = (0, contribution_ids_1.acUnitContributionId)(unitIndex);
    const base = {
        unitIndex,
        contributionId,
        dailyPlanStatus: "daily_plan_missing",
        dailyPlanRevision: meta.revision,
        slotStartIso: null,
        slotEndIso: null,
        allocatedPowerW: null,
        expectedPowerW: expectedPower.valid ? expectedPower.powerW : null,
        powerModelSource: expectedPower.valid ? expectedPower.source : "missing",
        allocationStatus: "unknown",
        allocationReasonDe: "",
        useDailyPlan: false,
        powerModelValid: expectedPower.valid,
        allocationAllowsStart: false,
    };
    if (!USABLE_DAILY_PLAN_STATUSES.has(meta.status)) {
        return {
            ...base,
            dailyPlanStatus: "daily_plan_invalid",
            allocationReasonDe: `Daily Plan Status „${meta.status}“ ist nicht verwendbar — autonomer Klima-Fallback aktiv.`,
        };
    }
    if (!isValidTimezone(timezone)) {
        return {
            ...base,
            dailyPlanStatus: "daily_plan_invalid",
            allocationReasonDe: "Zeitzone ungültig — autonomer Klima-Fallback aktiv.",
        };
    }
    const localDate = (0, time_1.localDateKeyInTimezone)(now, timezone);
    if (meta.date !== localDate) {
        return {
            ...base,
            dailyPlanStatus: "daily_plan_wrong_date",
            allocationReasonDe: `Daily Plan Datum (${meta.date}) entspricht nicht dem lokalen Tag (${localDate}) — Klima-Fallback aktiv.`,
        };
    }
    if (meta.validUntil) {
        const validUntilMs = Date.parse(meta.validUntil);
        if (!Number.isFinite(validUntilMs) || nowMs > validUntilMs) {
            return {
                ...base,
                dailyPlanStatus: "daily_plan_expired",
                allocationReasonDe: "Daily Plan ist abgelaufen — Klima-Fallback aktiv.",
            };
        }
    }
    const slotStartIso = (0, slots_1.slotStartIsoFloored)(now, timezone);
    if (!(0, time_1.isValidIsoTimestamp)(slotStartIso)) {
        return {
            ...base,
            dailyPlanStatus: "daily_plan_slot_missing",
            allocationReasonDe: "Aktueller Daily-Plan-Slot konnte nicht bestimmt werden — Klima-Fallback aktiv.",
        };
    }
    const slotStartMs = Date.parse(slotStartIso);
    const slotEndMs = slotStartMs + slots_1.DAILY_PLAN_SLOT_MS;
    const slotEndIso = (0, time_1.isoFromMs)(slotEndMs);
    if (nowMs < slotStartMs || nowMs >= slotEndMs) {
        return {
            ...base,
            dailyPlanStatus: "daily_plan_slot_missing",
            slotStartIso,
            slotEndIso,
            allocationReasonDe: "Aktueller Zeitpunkt liegt nicht im Daily-Plan-Slot — Klima-Fallback aktiv.",
        };
    }
    const merge = mergeUnitSlotAllocation(entries, contributionId, slotStartIso, slotEndIso);
    if (!merge.valid) {
        return {
            ...base,
            dailyPlanStatus: "daily_plan_allocation_invalid",
            slotStartIso,
            slotEndIso,
            allocationStatus: merge.allocationStatus,
            allocationReasonDe: `${merge.reasonDe} Klima-Fallback aktiv.`,
        };
    }
    if (!expectedPower.valid) {
        return {
            ...base,
            dailyPlanStatus: "missing_power_model",
            slotStartIso,
            slotEndIso,
            allocatedPowerW: merge.allocatedPowerW,
            allocationStatus: merge.allocationStatus,
            allocationReasonDe: "Kein belastbares Leistungsmodell für die Unit — Climate-Fallback aktiv.",
            useDailyPlan: false,
            allocationAllowsStart: false,
        };
    }
    let dailyPlanStatus = merge.allocatedPowerW <= 0 ? "daily_plan_zero_allocation" : "daily_plan_valid";
    let allocationReasonDe = merge.reasonDe;
    let allocationAllowsStart = merge.allocatedPowerW > 0;
    if (merge.allocatedPowerW > 0 && merge.allocatedPowerW < expectedPower.powerW) {
        dailyPlanStatus = "allocation_below_expected_power";
        allocationAllowsStart = false;
        allocationReasonDe = `Allocation ${merge.allocatedPowerW} W kleiner als erwartete Unit-Leistung ${expectedPower.powerW} W (${expectedPower.source}).`;
    }
    if (merge.allocatedPowerW <= 0) {
        allocationReasonDe = `${merge.reasonDe} Climate-Fallback aktiv.`;
    }
    return {
        unitIndex,
        contributionId,
        dailyPlanStatus,
        dailyPlanRevision: meta.revision,
        slotStartIso,
        slotEndIso,
        allocatedPowerW: merge.allocatedPowerW,
        expectedPowerW: expectedPower.powerW,
        powerModelSource: expectedPower.source,
        allocationStatus: merge.allocationStatus,
        allocationReasonDe,
        /** Positive allocation owns control (may still block start); 0 W → climate FSM. */
        useDailyPlan: merge.allocatedPowerW > 0,
        powerModelValid: true,
        allocationAllowsStart,
    };
}
exports.resolveAcUnitDailyPlanFromData = resolveAcUnitDailyPlanFromData;
async function loadSharedPlanData(host) {
    const adminCfg = (0, config_1.intentAdminConfigFromAdapter)(host.config);
    const timezone = adminCfg.timezone || "Europe/Berlin";
    const status = (await readStr(host, states_1.DAILY_PLAN_STATE_IDS.status)) ?? "";
    const date = (await readStr(host, states_1.DAILY_PLAN_STATE_IDS.date)) ?? "";
    const revision = (await readNum(host, states_1.DAILY_PLAN_STATE_IDS.revision)) ?? 0;
    const validUntilRaw = await readStr(host, states_1.DAILY_PLAN_STATE_IDS.validUntil);
    const validUntil = validUntilRaw && validUntilRaw.trim() ? validUntilRaw : null;
    const meta = { status, date, revision, validUntil, timezone };
    if (planCache && planCache.revision === revision) {
        return { meta, entries: planCache.entries };
    }
    const allocationStatus = (await readStr(host, states_1.ALLOCATION_ADDON_STATE_IDS.air_conditioning.status)) ?? "";
    const allocationRaw = parseJson(await readStr(host, states_1.ALLOCATION_ADDON_STATE_IDS.air_conditioning.planJson));
    const allocationEntries = parseDailyAllocationEntries(allocationRaw);
    const fullPlanRaw = parseJson(await readStr(host, states_1.DAILY_PLAN_STATE_IDS.planJson));
    const fullPlan = parseFullDailyPlan(fullPlanRaw);
    // ready/idle = Addon-Slice besitzt die Steuerung (auch bei [] = bewusst keine Fenster).
    const allocationOwns = allocationStatus === "ready" || allocationStatus === "idle";
    const entries = acEntriesFromSources(allocationEntries, allocationOwns ? null : fullPlan);
    planCache = { revision, entries, fullPlan };
    return { meta, entries };
}
async function resolveAcUnitDailyPlanAllocation(host, unit, consumerStats, now) {
    const expectedPower = resolveUnitExpectedPower(unit, consumerStats, now.getTime());
    const { meta, entries } = await loadSharedPlanData(host);
    if (!meta.status || meta.status === "not_initialized") {
        return {
            unitIndex: unit.index,
            contributionId: (0, contribution_ids_1.acUnitContributionId)(unit.index),
            dailyPlanStatus: "daily_plan_missing",
            dailyPlanRevision: meta.revision,
            slotStartIso: null,
            slotEndIso: null,
            allocatedPowerW: null,
            expectedPowerW: expectedPower.valid ? expectedPower.powerW : null,
            powerModelSource: expectedPower.valid ? expectedPower.source : "missing",
            allocationStatus: "missing",
            allocationReasonDe: "Daily Plan fehlt — bisherige autonome Klimaentscheidung wird verwendet.",
            useDailyPlan: false,
            powerModelValid: expectedPower.valid,
            allocationAllowsStart: false,
        };
    }
    return resolveAcUnitDailyPlanFromData({
        unitIndex: unit.index,
        now,
        timezone: meta.timezone,
        meta,
        entries,
        expectedPower,
    });
}
exports.resolveAcUnitDailyPlanAllocation = resolveAcUnitDailyPlanAllocation;
function evaluateAcCoolingPermission(input) {
    const { unitEnabled, governanceEnabled, addonEnabled, cleaningActive, fsm, dailyPlan, startRetryReady, } = input;
    const deviceWritesAllowed = governanceEnabled && addonEnabled;
    if (!unitEnabled) {
        return {
            decisionSource: "unit_disabled",
            reasonDe: "Innengerät deaktiviert.",
            allowStart: false,
            allowStop: deviceWritesAllowed && fsm.demandStop,
            allowCleaningWrites: false,
            deviceWritesAllowed,
        };
    }
    if (!governanceEnabled) {
        return {
            decisionSource: "governance_disabled",
            reasonDe: "Klima-Governance deaktiviert — keine EMS-Steueraktion.",
            allowStart: false,
            allowStop: false,
            allowCleaningWrites: false,
            deviceWritesAllowed: false,
        };
    }
    if (!addonEnabled) {
        return {
            decisionSource: "unit_disabled",
            reasonDe: "Klima-Add-on deaktiviert.",
            allowStart: false,
            allowStop: fsm.demandStop,
            allowCleaningWrites: false,
            deviceWritesAllowed: false,
        };
    }
    if (cleaningActive) {
        return {
            decisionSource: "cleaning",
            reasonDe: fsm.reasonDe,
            allowStart: false,
            allowStop: false,
            allowCleaningWrites: deviceWritesAllowed,
            deviceWritesAllowed,
        };
    }
    if (fsm.demandStart && !startRetryReady) {
        return {
            decisionSource: "rate_limited",
            reasonDe: "Start-Rate-Limit aktiv.",
            allowStart: false,
            allowStop: fsm.demandStop,
            allowCleaningWrites: deviceWritesAllowed,
            deviceWritesAllowed,
        };
    }
    let allowStart = fsm.demandStart;
    let decisionSource = "climate_fallback";
    let reasonDe = fsm.reasonDe;
    if (fsm.demandStart) {
        if (dailyPlan.useDailyPlan) {
            decisionSource = "daily_plan";
            if (!dailyPlan.allocationAllowsStart) {
                allowStart = false;
                reasonDe = dailyPlan.allocationReasonDe;
            }
            else {
                reasonDe = `${fsm.reasonDe} Daily Plan: ${dailyPlan.allocatedPowerW} W freigegeben.`;
            }
        }
        else {
            decisionSource = "climate_fallback";
            reasonDe = `${fsm.reasonDe} ${dailyPlan.allocationReasonDe}`.trim();
        }
    }
    else if (dailyPlan.useDailyPlan && dailyPlan.allocatedPowerW !== null && dailyPlan.allocatedPowerW > 0) {
        decisionSource = "temperature_no_demand";
        reasonDe = `Daily Plan stellt ${dailyPlan.allocatedPowerW} W bereit, aktuell kein Kühlbedarf.`;
    }
    else if (dailyPlan.useDailyPlan) {
        decisionSource = "daily_plan";
        reasonDe = dailyPlan.allocationReasonDe || fsm.reasonDe;
    }
    else if (!fsm.demandStop && !fsm.demandStart) {
        decisionSource = dailyPlan.useDailyPlan ? "daily_plan" : "climate_fallback";
    }
    return {
        decisionSource,
        reasonDe,
        allowStart: allowStart && deviceWritesAllowed,
        allowStop: fsm.demandStop && deviceWritesAllowed,
        allowCleaningWrites: deviceWritesAllowed,
        deviceWritesAllowed,
    };
}
exports.evaluateAcCoolingPermission = evaluateAcCoolingPermission;
function acUnitContributionIds() {
    const out = [];
    for (let i = 1; i <= constants_1.AC_UNIT_COUNT; i++) {
        out.push((0, contribution_ids_1.acUnitContributionId)(i));
    }
    return out;
}
exports.acUnitContributionIds = acUnitContributionIds;
