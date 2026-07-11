"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveImmersionDecisionSource = exports.resolveImmersionDailyPlanAllocation = exports.resolveImmersionDailyPlanFromData = exports.mergeSlotAllocations = exports.stageIndexForMaxPowerW = exports.parseDailyAllocationEntries = exports.resetImmersionDailyPlanCache = void 0;
const config_1 = require("../../../intent/config");
const contribution_ids_1 = require("../../../operator/contribution_ids");
const states_1 = require("../../../operator/daily_plan/states");
const slots_1 = require("../../../operator/daily_plan/slots");
const time_1 = require("../../../operator/time");
const ACTIVE_ALLOCATION_STATUSES = new Set(["allocated", "partially_allocated"]);
const IMMERSION_CONTRIBUTION_IDS = new Set([
    contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY,
    contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
]);
const USABLE_DAILY_PLAN_STATUSES = new Set(["ready", "degraded"]);
let planCache = null;
function resetImmersionDailyPlanCache() {
    planCache = null;
}
exports.resetImmersionDailyPlanCache = resetImmersionDailyPlanCache;
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
function immersionEntriesFromSources(allocationEntries, fullPlan) {
    const seen = new Set();
    const out = [];
    const add = (entries) => {
        for (const e of entries) {
            if (!IMMERSION_CONTRIBUTION_IDS.has(e.contributionId))
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
        add(fullPlan.allocations.filter((a) => IMMERSION_CONTRIBUTION_IDS.has(a.contributionId)));
    }
    return out;
}
function maxTechnicalPowerW(config) {
    let max = 0;
    for (const s of config.stages) {
        if (s.enabled && s.nominalPowerW > 0 && s.setStateId) {
            max = Math.max(max, s.nominalPowerW);
        }
    }
    return max;
}
function stageIndexForMaxPowerW(config, maxPowerW) {
    if (maxPowerW <= 0) {
        return { stageIndex: 0, reasonDe: "Keine Daily-Plan-Allocation-Leistung für den aktuellen Slot." };
    }
    const enabled = config.stages.filter((s) => s.enabled && s.nominalPowerW > 0 && s.setStateId);
    if (enabled.length === 0) {
        return { stageIndex: 0, reasonDe: "Keine technisch verfügbare Heizstabstufe konfiguriert." };
    }
    const sortedDesc = [...enabled].sort((a, b) => b.nominalPowerW - a.nominalPowerW);
    for (const stage of sortedDesc) {
        if (stage.nominalPowerW <= maxPowerW) {
            return {
                stageIndex: stage.index,
                reasonDe: `Stufe ${stage.index} (${stage.nominalPowerW} W) innerhalb Daily-Plan-Obergrenze ${maxPowerW} W.`,
            };
        }
    }
    const minStage = [...enabled].sort((a, b) => a.nominalPowerW - b.nominalPowerW)[0];
    return {
        stageIndex: 0,
        reasonDe: `Daily-Plan-Allocation ${maxPowerW} W kleiner als kleinste Stufe (${minStage.nominalPowerW} W).`,
    };
}
exports.stageIndexForMaxPowerW = stageIndexForMaxPowerW;
function mergeSlotAllocations(entries, slotStartIso, slotEndIso) {
    const key = (0, slots_1.slotKey)(slotStartIso, slotEndIso);
    const seen = new Set();
    let mandatoryPowerW = 0;
    let flexiblePowerW = 0;
    const statuses = [];
    for (const entry of entries) {
        if ((0, slots_1.slotKey)(entry.slot.startIso, entry.slot.endIso) !== key)
            continue;
        if (!IMMERSION_CONTRIBUTION_IDS.has(entry.contributionId))
            continue;
        const dedupeKey = `${entry.contributionId}|${key}`;
        if (seen.has(dedupeKey)) {
            return {
                mandatoryPowerW: 0,
                flexiblePowerW: 0,
                totalPowerW: 0,
                allocationStatus: "duplicate",
                reasonDe: "Doppelte Daily-Plan-Allocation im selben Slot.",
                valid: false,
            };
        }
        seen.add(dedupeKey);
        if (!ACTIVE_ALLOCATION_STATUSES.has(entry.status))
            continue;
        if (entry.allocatedPowerW === null || !Number.isFinite(entry.allocatedPowerW) || entry.allocatedPowerW < 0) {
            return {
                mandatoryPowerW: 0,
                flexiblePowerW: 0,
                totalPowerW: 0,
                allocationStatus: "invalid_power",
                reasonDe: "Ungültige Daily-Plan-Allocation-Leistung.",
                valid: false,
            };
        }
        statuses.push(entry.status);
        if (entry.contributionId === contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY) {
            mandatoryPowerW += entry.allocatedPowerW;
        }
        else if (entry.contributionId === contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE) {
            flexiblePowerW += entry.allocatedPowerW;
        }
    }
    const totalPowerW = mandatoryPowerW + flexiblePowerW;
    const allocationStatus = statuses.length === 0
        ? "none"
        : statuses.includes("partially_allocated")
            ? "partially_allocated"
            : "allocated";
    const parts = [];
    if (mandatoryPowerW > 0)
        parts.push(`Pflicht ${mandatoryPowerW} W`);
    if (flexiblePowerW > 0)
        parts.push(`flexibel ${flexiblePowerW} W`);
    const reasonDe = totalPowerW > 0
        ? `Daily Plan: ${parts.join(", ")} (Summe ${totalPowerW} W).`
        : "Daily Plan: keine aktive Heizstab-Allocation im aktuellen Slot (0 W).";
    return {
        mandatoryPowerW,
        flexiblePowerW,
        totalPowerW,
        allocationStatus,
        reasonDe,
        valid: true,
    };
}
exports.mergeSlotAllocations = mergeSlotAllocations;
function resolveImmersionDailyPlanFromData(input) {
    const { now, timezone, meta, entries, config } = input;
    const nowMs = now.getTime();
    const base = {
        dailyPlanStatus: "daily_plan_missing",
        decisionSource: "thermal_fallback",
        dailyPlanRevision: meta.revision,
        slotStartIso: null,
        slotEndIso: null,
        allocatedPowerW: null,
        mandatoryAllocatedPowerW: null,
        flexibleAllocatedPowerW: null,
        allocationStatus: "unknown",
        allocationReasonDe: "",
        commandedStage: 0,
        useDailyPlan: false,
    };
    if (!USABLE_DAILY_PLAN_STATUSES.has(meta.status)) {
        return {
            ...base,
            dailyPlanStatus: "daily_plan_invalid",
            allocationReasonDe: `Daily Plan Status „${meta.status}“ ist nicht verwendbar – Thermal-Fallback aktiv.`,
        };
    }
    if (!isValidTimezone(timezone)) {
        return {
            ...base,
            dailyPlanStatus: "daily_plan_invalid",
            allocationReasonDe: "Zeitzone ungültig – Thermal-Fallback aktiv.",
        };
    }
    const localDate = (0, time_1.localDateKeyInTimezone)(now, timezone);
    if (meta.date !== localDate) {
        return {
            ...base,
            dailyPlanStatus: "daily_plan_wrong_date",
            allocationReasonDe: `Daily Plan Datum (${meta.date}) entspricht nicht dem lokalen Tag (${localDate}) – Thermal-Fallback aktiv.`,
        };
    }
    if (meta.validUntil) {
        const validUntilMs = Date.parse(meta.validUntil);
        if (!Number.isFinite(validUntilMs) || nowMs > validUntilMs) {
            return {
                ...base,
                dailyPlanStatus: "daily_plan_expired",
                allocationReasonDe: "Daily Plan ist abgelaufen – Thermal-Fallback aktiv.",
            };
        }
    }
    const slotStartIso = (0, slots_1.slotStartIsoFloored)(now, timezone);
    if (!(0, time_1.isValidIsoTimestamp)(slotStartIso)) {
        return {
            ...base,
            dailyPlanStatus: "daily_plan_slot_missing",
            allocationReasonDe: "Aktueller Daily-Plan-Slot konnte nicht bestimmt werden – Thermal-Fallback aktiv.",
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
            allocationReasonDe: "Aktueller Zeitpunkt liegt nicht im Daily-Plan-Slot – Thermal-Fallback aktiv.",
        };
    }
    const merge = mergeSlotAllocations(entries, slotStartIso, slotEndIso);
    if (!merge.valid) {
        return {
            ...base,
            dailyPlanStatus: "daily_plan_allocation_invalid",
            slotStartIso,
            slotEndIso,
            allocationStatus: merge.allocationStatus,
            allocationReasonDe: `${merge.reasonDe} Thermal-Fallback aktiv.`,
        };
    }
    const techMax = maxTechnicalPowerW(config);
    const cappedPowerW = techMax > 0 ? Math.min(merge.totalPowerW, techMax) : merge.totalPowerW;
    const stagePick = stageIndexForMaxPowerW(config, cappedPowerW);
    const dailyPlanStatus = cappedPowerW <= 0 ? "daily_plan_zero_allocation" : "daily_plan_valid";
    return {
        dailyPlanStatus,
        decisionSource: "daily_plan",
        dailyPlanRevision: meta.revision,
        slotStartIso,
        slotEndIso,
        allocatedPowerW: cappedPowerW,
        mandatoryAllocatedPowerW: merge.mandatoryPowerW,
        flexibleAllocatedPowerW: merge.flexiblePowerW,
        allocationStatus: merge.allocationStatus,
        allocationReasonDe: cappedPowerW <= 0 ? merge.reasonDe : stagePick.reasonDe,
        commandedStage: stagePick.stageIndex,
        useDailyPlan: true,
    };
}
exports.resolveImmersionDailyPlanFromData = resolveImmersionDailyPlanFromData;
async function loadPlanData(host) {
    const adminCfg = (0, config_1.intentAdminConfigFromAdapter)(host.config);
    const timezone = adminCfg.timezone || "Europe/Berlin";
    const status = (await readStr(host, states_1.DAILY_PLAN_STATE_IDS.status)) ?? "";
    const date = (await readStr(host, states_1.DAILY_PLAN_STATE_IDS.date)) ?? "";
    const revision = (await readNum(host, states_1.DAILY_PLAN_STATE_IDS.revision)) ?? 0;
    const validUntilRaw = await readStr(host, states_1.DAILY_PLAN_STATE_IDS.validUntil);
    const validUntil = validUntilRaw && validUntilRaw.trim() ? validUntilRaw : null;
    const meta = { status, date, revision, validUntil, timezone };
    if (planCache && planCache.revision === revision) {
        return { meta, entries: planCache.entries, fullPlan: planCache.fullPlan };
    }
    const allocationRaw = parseJson(await readStr(host, states_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson));
    const allocationEntries = parseDailyAllocationEntries(allocationRaw);
    const fullPlanRaw = parseJson(await readStr(host, states_1.DAILY_PLAN_STATE_IDS.planJson));
    const fullPlan = parseFullDailyPlan(fullPlanRaw);
    const entries = immersionEntriesFromSources(allocationEntries, fullPlan);
    planCache = { revision, entries, fullPlan };
    return { meta, entries, fullPlan };
}
async function resolveImmersionDailyPlanAllocation(host, config, now) {
    const { meta, entries } = await loadPlanData(host);
    if (!meta.status || meta.status === "not_initialized") {
        return {
            dailyPlanStatus: "daily_plan_missing",
            decisionSource: "thermal_fallback",
            dailyPlanRevision: meta.revision,
            slotStartIso: null,
            slotEndIso: null,
            allocatedPowerW: null,
            mandatoryAllocatedPowerW: null,
            flexibleAllocatedPowerW: null,
            allocationStatus: "missing",
            allocationReasonDe: "Daily Plan fehlt – bisheriger Thermal-Planner wird verwendet.",
            commandedStage: 0,
            useDailyPlan: false,
        };
    }
    return resolveImmersionDailyPlanFromData({
        now,
        timezone: meta.timezone,
        meta,
        entries,
        config,
    });
}
exports.resolveImmersionDailyPlanAllocation = resolveImmersionDailyPlanAllocation;
function resolveImmersionDecisionSource(resolvedMode, failsafeActive, faultLockout, fsmState, autoSource) {
    if (faultLockout) {
        return fsmState === "fault_lockout" ? "lockout" : "fault";
    }
    if (failsafeActive)
        return "safety";
    if (resolvedMode === "off")
        return "manual_off";
    if (resolvedMode === "force")
        return "manual_force";
    if (resolvedMode === "auto")
        return autoSource;
    return "safe_default";
}
exports.resolveImmersionDecisionSource = resolveImmersionDecisionSource;
