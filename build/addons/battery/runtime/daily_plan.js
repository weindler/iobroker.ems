"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isChargingDeviceIntent = exports.dailyPlanWantsCharge = exports.resolveBatteryDailyPlanAllocation = exports.deviceIntentFromDailyPlan = exports.resolveBatteryDailyPlanFromData = exports.mergeBatteryChargeSlotAllocation = exports.parseDailyAllocationEntries = exports.isBatteryDailyPlanAuthoritative = exports.resetBatteryDailyPlanCache = void 0;
const config_1 = require("../../../intent/config");
const contribution_ids_1 = require("../../../operator/contribution_ids");
const states_1 = require("../../../operator/daily_plan/states");
const slots_1 = require("../../../operator/daily_plan/slots");
const time_1 = require("../../../operator/time");
const intent_1 = require("../core/intent");
const BATTERY_CHARGE_ID = contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE;
const BATTERY_DISCHARGE_ID = contribution_ids_1.CONTRIBUTION_IDS.BATTERY_DISCHARGE;
const ACTIVE_ALLOCATION_STATUSES = new Set(["allocated", "partially_allocated"]);
const USABLE_DAILY_PLAN_STATUSES = new Set(["ready", "degraded"]);
let planCache = null;
function resetBatteryDailyPlanCache() {
    planCache = null;
}
exports.resetBatteryDailyPlanCache = resetBatteryDailyPlanCache;
function isBatteryDailyPlanAuthoritative(ctx) {
    return ctx.dailyPlanAuthoritative;
}
exports.isBatteryDailyPlanAuthoritative = isBatteryDailyPlanAuthoritative;
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
function batteryChargeEntriesFromSources(allocationEntries, fullPlan) {
    const seen = new Set();
    const out = [];
    let dischargePresent = false;
    const add = (entries) => {
        for (const e of entries) {
            if (e.contributionId === BATTERY_DISCHARGE_ID) {
                dischargePresent = true;
                continue;
            }
            if (e.contributionId !== BATTERY_CHARGE_ID)
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
    if (fullPlan)
        add(fullPlan.allocations);
    return { entries: out, dischargePresent };
}
function mergeBatteryChargeSlotAllocation(entries, slotStartIso, slotEndIso) {
    const key = (0, slots_1.slotKey)(slotStartIso, slotEndIso);
    let found = null;
    for (const entry of entries) {
        if (entry.contributionId !== BATTERY_CHARGE_ID)
            continue;
        if ((0, slots_1.slotKey)(entry.slot.startIso, entry.slot.endIso) !== key)
            continue;
        if (found) {
            return {
                valid: false,
                entry: null,
                allocationStatus: "duplicate",
                reasonDe: "Doppelte battery.charge-Allocation im selben Slot.",
            };
        }
        found = entry;
    }
    if (!found) {
        return {
            valid: true,
            entry: null,
            allocationStatus: "none",
            reasonDe: "Daily Plan: keine battery.charge-Allocation im aktuellen Slot.",
        };
    }
    return { valid: true, entry: found, allocationStatus: found.status, reasonDe: found.reasonDe || "" };
}
exports.mergeBatteryChargeSlotAllocation = mergeBatteryChargeSlotAllocation;
function mapEnergySource(src) {
    if (src === "pv_surplus")
        return "pv";
    if (src === "grid")
        return "grid";
    if (src === "mixed")
        return "any";
    return "unknown";
}
function resolveTargetSocPct(input) {
    if (input.topOffActive)
        return input.limits.maxSocPct ?? 100;
    if (input.targetSocFromIntent !== null)
        return input.targetSocFromIntent;
    return input.limits.maxSocPct;
}
function resolveBatteryDailyPlanFromData(input) {
    const { now, timezone, meta, entries, dischargePresent, profile, limits, socPct, topOffActive, governanceEnabled } = input;
    const nowMs = now.getTime();
    const fallbackBase = () => ({
        useDailyPlan: false,
        dailyPlanAuthoritative: false,
        dailyPlanStatus: "daily_plan_missing",
        decisionSource: "battery_winter_fallback",
        dailyPlanRevision: meta.revision,
        slotStartIso: null,
        slotEndIso: null,
        allocationStatus: "unknown",
        allocatedChargePowerW: null,
        effectiveChargePowerW: null,
        requestedChargePowerW: null,
        allocatedEnergyKwh: null,
        pvPowerW: null,
        gridPowerW: null,
        energySource: "none",
        estimatedCostCt: null,
        chargePowerCapped: false,
        targetSocPct: null,
        topOffActive,
        chargingAllowed: false,
        allocationReasonDe: "",
        legacyFallbackActive: true,
        legacyFallbackSource: "pending",
        legacyFallbackReasonDe: "",
        dailyPlanBlocksGridBalance: false,
        runtimeControlAvailable: profile.supportsLive,
        dischargeIgnored: dischargePresent,
    });
    if (!governanceEnabled) {
        return {
            ...fallbackBase(),
            decisionSource: "governance_disabled",
            legacyFallbackActive: false,
            allocationReasonDe: "Governance deaktiviert — kein Daily-Plan-Ladepfad.",
        };
    }
    if (!profile.supportsLive) {
        return {
            ...fallbackBase(),
            dailyPlanStatus: "profile_read_only",
            decisionSource: "profile_read_only",
            legacyFallbackActive: false,
            allocationReasonDe: "Profil read-only — Daily Plan nur diagnostisch.",
        };
    }
    if (!meta.status || meta.status === "not_initialized") {
        return {
            ...fallbackBase(),
            allocationReasonDe: "Daily Plan fehlt — Legacy-Fallback aktiv.",
            legacyFallbackReasonDe: "Daily Plan fehlt.",
        };
    }
    if (!USABLE_DAILY_PLAN_STATUSES.has(meta.status)) {
        return {
            ...fallbackBase(),
            dailyPlanStatus: "daily_plan_invalid",
            allocationReasonDe: `Daily Plan Status „${meta.status}“ ungültig — Legacy-Fallback.`,
            legacyFallbackReasonDe: `Status ${meta.status}.`,
        };
    }
    if (!isValidTimezone(timezone)) {
        return {
            ...fallbackBase(),
            dailyPlanStatus: "daily_plan_invalid",
            allocationReasonDe: "Zeitzone ungültig — Legacy-Fallback.",
            legacyFallbackReasonDe: "Zeitzone ungültig.",
        };
    }
    const localDate = (0, time_1.localDateKeyInTimezone)(now, timezone);
    if (meta.date !== localDate) {
        return {
            ...fallbackBase(),
            dailyPlanStatus: "daily_plan_wrong_date",
            allocationReasonDe: `Daily Plan Datum (${meta.date}) passt nicht — Legacy-Fallback.`,
            legacyFallbackReasonDe: "Falsches Plan-Datum.",
        };
    }
    if (meta.validUntil) {
        const validUntilMs = Date.parse(meta.validUntil);
        if (!Number.isFinite(validUntilMs) || nowMs > validUntilMs) {
            return {
                ...fallbackBase(),
                dailyPlanStatus: "daily_plan_expired",
                allocationReasonDe: "Daily Plan abgelaufen — Legacy-Fallback.",
                legacyFallbackReasonDe: "Plan abgelaufen.",
            };
        }
    }
    const slotStartIso = (0, slots_1.slotStartIsoFloored)(now, timezone);
    if (!(0, time_1.isValidIsoTimestamp)(slotStartIso)) {
        return {
            ...fallbackBase(),
            dailyPlanStatus: "daily_plan_slot_missing",
            allocationReasonDe: "Slot nicht bestimmbar — Legacy-Fallback.",
            legacyFallbackReasonDe: "Slot fehlt.",
        };
    }
    const slotStartMs = Date.parse(slotStartIso);
    const slotEndIso = (0, time_1.isoFromMs)(slotStartMs + slots_1.DAILY_PLAN_SLOT_MS);
    if (nowMs < slotStartMs || nowMs >= slotStartMs + slots_1.DAILY_PLAN_SLOT_MS) {
        return {
            ...fallbackBase(),
            dailyPlanStatus: "daily_plan_slot_missing",
            slotStartIso,
            slotEndIso,
            allocationReasonDe: "Aktueller Zeitpunkt liegt nicht im Slot — Legacy-Fallback.",
            legacyFallbackReasonDe: "Zeitpunkt außerhalb Slot.",
        };
    }
    const merge = mergeBatteryChargeSlotAllocation(entries, slotStartIso, slotEndIso);
    if (!merge.valid) {
        return {
            ...fallbackBase(),
            dailyPlanStatus: "daily_plan_allocation_invalid",
            slotStartIso,
            slotEndIso,
            allocationStatus: merge.allocationStatus,
            allocationReasonDe: `${merge.reasonDe} Legacy-Fallback.`,
            legacyFallbackReasonDe: merge.reasonDe,
        };
    }
    const targetSocPct = resolveTargetSocPct({
        topOffActive,
        targetSocFromIntent: input.targetSocFromIntent,
        limits,
    });
    const authoritativeBase = () => ({
        useDailyPlan: true,
        dailyPlanAuthoritative: true,
        dailyPlanStatus: "daily_plan_zero_allocation",
        decisionSource: "daily_plan_zero",
        dailyPlanRevision: meta.revision,
        slotStartIso,
        slotEndIso,
        allocationStatus: merge.allocationStatus,
        allocatedChargePowerW: 0,
        effectiveChargePowerW: 0,
        requestedChargePowerW: null,
        allocatedEnergyKwh: null,
        pvPowerW: 0,
        gridPowerW: 0,
        energySource: "none",
        estimatedCostCt: null,
        chargePowerCapped: false,
        targetSocPct,
        topOffActive,
        chargingAllowed: false,
        allocationReasonDe: "Daily Plan: keine aktive Batterieladung im aktuellen Slot.",
        legacyFallbackActive: false,
        legacyFallbackSource: "",
        legacyFallbackReasonDe: "",
        dailyPlanBlocksGridBalance: true,
        runtimeControlAvailable: profile.supportsLive,
        dischargeIgnored: dischargePresent,
    });
    const entry = merge.entry;
    if (!entry || !ACTIVE_ALLOCATION_STATUSES.has(entry.status)) {
        return authoritativeBase();
    }
    if (entry.allocatedPowerW === null || !Number.isFinite(entry.allocatedPowerW) || entry.allocatedPowerW < 0) {
        return {
            ...authoritativeBase(),
            dailyPlanStatus: "daily_plan_allocation_invalid",
            decisionSource: "daily_plan_zero",
            allocationReasonDe: "Ungültige oder negative Daily-Plan-Ladeleistung abgelehnt.",
        };
    }
    if (entry.allocatedPowerW === 0) {
        return authoritativeBase();
    }
    const hwMax = limits.maxChargeW;
    let effective = Math.round(entry.allocatedPowerW);
    let chargePowerCapped = false;
    if (hwMax !== null && effective > hwMax) {
        effective = hwMax;
        chargePowerCapped = true;
    }
    const energySource = entry.energySource;
    if (energySource === "grid" && entry.gridPowerW <= 0) {
        return {
            ...authoritativeBase(),
            dailyPlanStatus: "grid_not_eligible",
            allocationReasonDe: "Grid-Allocation ohne Netzanteil — keine Ladefreigabe.",
        };
    }
    if (socPct !== null && targetSocPct !== null && socPct >= targetSocPct) {
        return {
            ...authoritativeBase(),
            dailyPlanStatus: "soc_at_target",
            allocationReasonDe: `SOC ${socPct} % erreicht Ziel ${targetSocPct} % — keine weitere Ladung.`,
        };
    }
    const dailyPlanStatus = chargePowerCapped ? "allocation_capped" : "daily_plan_valid";
    const passivePv = energySource === "pv_surplus" && entry.pvPowerW > 0 && entry.gridPowerW === 0;
    return {
        useDailyPlan: true,
        dailyPlanAuthoritative: true,
        dailyPlanStatus,
        decisionSource: passivePv ? "daily_plan_passive_pv" : "daily_plan",
        dailyPlanRevision: meta.revision,
        slotStartIso,
        slotEndIso,
        allocationStatus: merge.allocationStatus,
        allocatedChargePowerW: entry.allocatedPowerW,
        effectiveChargePowerW: effective,
        requestedChargePowerW: entry.requestedPowerW,
        allocatedEnergyKwh: entry.allocatedEnergyKwh,
        pvPowerW: entry.pvPowerW,
        gridPowerW: entry.gridPowerW,
        energySource,
        estimatedCostCt: entry.estimatedCostCt,
        chargePowerCapped,
        targetSocPct,
        topOffActive,
        chargingAllowed: true,
        allocationReasonDe: chargePowerCapped
            ? `Daily Plan ${entry.allocatedPowerW} W auf technisches Maximum ${effective} W begrenzt.`
            : `Daily Plan sieht ${effective} W Batterieladung vor (${energySource}).`,
        legacyFallbackActive: false,
        legacyFallbackSource: "",
        legacyFallbackReasonDe: "",
        dailyPlanBlocksGridBalance: true,
        runtimeControlAvailable: profile.supportsLive,
        dischargeIgnored: dischargePresent,
    };
}
exports.resolveBatteryDailyPlanFromData = resolveBatteryDailyPlanFromData;
function deviceIntentFromDailyPlan(ctx, nowMs) {
    const revision = ctx.dailyPlanRevision ?? 0;
    if (!ctx.chargingAllowed || (ctx.effectiveChargePowerW ?? 0) <= 0) {
        return {
            requestId: `daily-plan-${revision}`,
            action: "self_consumption",
            targetSocPct: ctx.targetSocPct,
            maxChargeW: 0,
            maxDischargeW: null,
            energySource: "any",
            validFrom: ctx.slotStartIso,
            validUntil: ctx.slotEndIso,
            issuedAt: new Date(nowMs).toISOString(),
            reason: ctx.allocationReasonDe,
            source: "daily_plan",
        };
    }
    let action = "charge";
    if (ctx.energySource === "grid" || (ctx.energySource === "mixed" && (ctx.gridPowerW ?? 0) > 0)) {
        action = "grid_charge";
    }
    return {
        requestId: `daily-plan-${revision}`,
        action,
        targetSocPct: ctx.targetSocPct,
        maxChargeW: ctx.effectiveChargePowerW,
        maxDischargeW: null,
        energySource: mapEnergySource(ctx.energySource),
        validFrom: ctx.slotStartIso,
        validUntil: ctx.slotEndIso,
        issuedAt: new Date(nowMs).toISOString(),
        reason: ctx.allocationReasonDe,
        source: "daily_plan",
    };
}
exports.deviceIntentFromDailyPlan = deviceIntentFromDailyPlan;
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
        const { entries, dischargePresent } = batteryChargeEntriesFromSources(planCache.entries, planCache.fullPlan);
        return { meta, entries, dischargePresent, parseError: false };
    }
    const allocationRaw = parseJson(await readStr(host, states_1.ALLOCATION_ADDON_STATE_IDS.battery.planJson));
    const allocationEntries = parseDailyAllocationEntries(allocationRaw);
    const fullPlanRaw = parseJson(await readStr(host, states_1.DAILY_PLAN_STATE_IDS.planJson));
    const fullPlan = parseFullDailyPlan(fullPlanRaw);
    const parseError = allocationRaw === undefined || (allocationEntries === null && allocationRaw !== null);
    if (parseError) {
        planCache = { revision, entries: [], fullPlan: null, parseError: true };
        return { meta, entries: [], dischargePresent: false, parseError: true };
    }
    const merged = batteryChargeEntriesFromSources(allocationEntries, fullPlan);
    planCache = { revision, entries: merged.entries, fullPlan, parseError: false };
    return { meta, entries: merged.entries, dischargePresent: merged.dischargePresent, parseError: false };
}
async function resolveBatteryDailyPlanAllocation(host, profile, limits, opts) {
    const { meta, entries, dischargePresent, parseError } = await loadPlanData(host);
    if (parseError) {
        return resolveBatteryDailyPlanFromData({
            now: opts.now,
            timezone: meta.timezone,
            meta: { ...meta, status: "error" },
            entries: [],
            dischargePresent: false,
            profile,
            limits,
            socPct: opts.socPct,
            topOffActive: opts.topOffActive,
            targetSocFromIntent: opts.targetSocFromIntent,
            governanceEnabled: opts.governanceEnabled,
        });
    }
    return resolveBatteryDailyPlanFromData({
        now: opts.now,
        timezone: meta.timezone,
        meta,
        entries,
        dischargePresent,
        profile,
        limits,
        socPct: opts.socPct,
        topOffActive: opts.topOffActive,
        targetSocFromIntent: opts.targetSocFromIntent,
        governanceEnabled: opts.governanceEnabled,
    });
}
exports.resolveBatteryDailyPlanAllocation = resolveBatteryDailyPlanAllocation;
function dailyPlanWantsCharge(ctx) {
    return ctx.chargingAllowed && (ctx.effectiveChargePowerW ?? 0) > 0;
}
exports.dailyPlanWantsCharge = dailyPlanWantsCharge;
function isChargingDeviceIntent(intent) {
    return (0, intent_1.isChargingAction)(intent.action);
}
exports.isChargingDeviceIntent = isChargingDeviceIntent;
