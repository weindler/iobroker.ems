"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveExternalSourceQuality = exports.normalizeSmartChargingActive = exports.externalControlEnabledFromConfig = exports.currentOrFutureSlots = exports.computeExternalPlanRemainingEnergy = exports.resolveDeadlineIso = exports.parseTimestampToMs = exports.parseStandaloneStartEnd = exports.parseSmartPlanPayload = exports.timezoneFromAdapterConfig = exports.readExternalEvInformation = void 0;
const time_1 = require("../../../../operator/time");
const config_1 = require("../../../../intent/config");
const types_1 = require("./types");
const smart_plan_parse_1 = require("./smart_plan_parse");
const remaining_energy_1 = require("./remaining_energy");
const quality_1 = require("./quality");
async function readForeign(host, objectId) {
    if (!objectId)
        return null;
    const st = host.getForeignStateAsync
        ? await host.getForeignStateAsync(objectId)
        : await host.getStateAsync(objectId);
    if (!st || st.val === undefined)
        return null;
    const lc = typeof st.lc === "number" && Number.isFinite(st.lc) ? st.lc : null;
    const ts = typeof st.ts === "number" && Number.isFinite(st.ts) ? st.ts : null;
    return { val: st.val, tsMs: ts, lcMs: lc };
}
function mapped(id) {
    return id.trim().length > 0;
}
function maxTs(values) {
    let best = null;
    for (const v of values) {
        if (v === null)
            continue;
        if (best === null || v > best)
            best = v;
    }
    return best;
}
function buildSmartPlanEval(input) {
    const eval_ = {
        ...(0, types_1.emptySmartPlanEval)(),
        mappingConfigured: input.mappingConfigured,
    };
    if (!input.mappingConfigured) {
        return eval_;
    }
    const hasPayload = input.planRead != null || (input.startRead != null && input.endRead != null);
    eval_.stateReadable = hasPayload;
    if (!hasPayload) {
        return eval_;
    }
    let parsed = (0, smart_plan_parse_1.parseSmartPlanPayload)(input.planRead?.val ?? null);
    if ((!parsed.parseable || parsed.slots.length === 0) && input.startRead && input.endRead) {
        const pair = (0, smart_plan_parse_1.parseStandaloneStartEnd)(input.startRead.val, input.endRead.val);
        if (pair) {
            parsed = { slots: [pair], ignoredCount: parsed.ignoredCount, parseable: true, error: null };
        }
    }
    eval_.payloadParseable = parsed.parseable;
    eval_.parseError = parsed.error;
    eval_.rawPreview = (0, smart_plan_parse_1.previewRaw)(input.planRead?.val ?? null);
    eval_.parsedSlotCount = parsed.slots.length;
    eval_.ignoredSlotCount = parsed.ignoredCount;
    if (!parsed.parseable) {
        return eval_;
    }
    if (input.planEnabled === false) {
        eval_.validPlanPresent = false;
        eval_.slots = [];
        return eval_;
    }
    const usable = (0, remaining_energy_1.currentOrFutureSlots)(parsed.slots, input.nowMs);
    eval_.slots = usable;
    eval_.validPlanPresent = usable.length > 0;
    if (usable.length > 0) {
        eval_.nextStart = usable.reduce((min, s) => (min === null || s.start < min ? s.start : min), null);
        eval_.lastEnd = usable.reduce((max, s) => (max === null || s.end > max ? s.end : max), null);
    }
    const deadlineMs = input.deadlineIso ? Date.parse(input.deadlineIso) : null;
    const remaining = (0, remaining_energy_1.computeExternalPlanRemainingEnergy)({
        slots: usable,
        nowMs: input.nowMs,
        deadlineMs: deadlineMs != null && Number.isFinite(deadlineMs) ? deadlineMs : null,
        fallbackMaxAcKw: input.fallbackMaxAcKw,
    });
    eval_.remainingEnergyKWh = remaining.remainingEnergyKWh;
    eval_.remainingMinutes = remaining.remainingMinutes;
    eval_.remainingEnergyEstimated = remaining.estimated;
    eval_.deadlineUsed = input.deadlineIso != null;
    eval_.deadlineIso = input.deadlineIso;
    return eval_;
}
/**
 * Read-only source adapter: generic ioBroker mappings → ExternalEvInformation.
 * Ford/vehicle-pause is diagnostic only and never sets externalControlActive.
 */
async function readExternalEvInformation(host, foundation, opts) {
    const nowMs = opts.now.getTime();
    const controlEnabled = (0, quality_1.externalControlEnabledFromConfig)(foundation);
    const controlRead = mapped(foundation.externalControlActiveStateId)
        ? await readForeign(host, foundation.externalControlActiveStateId)
        : null;
    const rewardsRead = mapped(foundation.externalGridRewardsActiveStateId)
        ? await readForeign(host, foundation.externalGridRewardsActiveStateId)
        : null;
    const chargingRead = mapped(foundation.externalSmartChargingStatusStateId)
        ? await readForeign(host, foundation.externalSmartChargingStatusStateId)
        : null;
    const planRead = mapped(foundation.externalSmartPlanStateId)
        ? await readForeign(host, foundation.externalSmartPlanStateId)
        : null;
    const planEnabledRead = mapped(foundation.externalSmartPlanEnabledStateId)
        ? await readForeign(host, foundation.externalSmartPlanEnabledStateId)
        : null;
    const startRead = mapped(foundation.externalSmartPlanStartStateId)
        ? await readForeign(host, foundation.externalSmartPlanStartStateId)
        : null;
    const endRead = mapped(foundation.externalSmartPlanEndStateId)
        ? await readForeign(host, foundation.externalSmartPlanEndStateId)
        : null;
    const deadlineRead = mapped(foundation.externalPlanDeadlineStateId)
        ? await readForeign(host, foundation.externalPlanDeadlineStateId)
        : null;
    const targetRead = mapped(foundation.externalTargetSocStateId)
        ? await readForeign(host, foundation.externalTargetSocStateId)
        : null;
    const pauseRead = mapped(foundation.vehicleChargePauseStateId)
        ? await readForeign(host, foundation.vehicleChargePauseStateId)
        : null;
    const heartbeatRead = mapped(foundation.externalSourceUpdatedAtStateId)
        ? await readForeign(host, foundation.externalSourceUpdatedAtStateId)
        : null;
    const minSocRead = mapped(foundation.externalSmartChargingMinSocStateId)
        ? await readForeign(host, foundation.externalSmartChargingMinSocStateId)
        : null;
    const planMappingConfigured = mapped(foundation.externalSmartPlanStateId) ||
        (mapped(foundation.externalSmartPlanStartStateId) && mapped(foundation.externalSmartPlanEndStateId));
    const controlMapped = mapped(foundation.externalControlActiveStateId);
    const rewardsMapped = mapped(foundation.externalGridRewardsActiveStateId);
    const chargingMapped = mapped(foundation.externalSmartChargingStatusStateId);
    const configured = controlEnabled ||
        controlMapped ||
        rewardsMapped ||
        chargingMapped ||
        planMappingConfigured ||
        mapped(foundation.externalPlanDeadlineStateId) ||
        mapped(foundation.externalTargetSocStateId) ||
        mapped(foundation.externalSmartChargingMinSocStateId) ||
        mapped(foundation.externalSourceUpdatedAtStateId);
    const externalControlActive = controlMapped
        ? controlRead
            ? (0, quality_1.normalizeOptionalBoolOrNull)(controlRead.val)
            : null
        : null;
    const gridRewardsActive = rewardsMapped
        ? rewardsRead
            ? (0, quality_1.normalizeOptionalBoolOrNull)(rewardsRead.val)
            : null
        : null;
    const smartChargingActive = chargingMapped
        ? chargingRead
            ? (0, quality_1.normalizeSmartChargingActive)(chargingRead.val)
            : null
        : null;
    const vehicleChargePauseDiagnostic = mapped(foundation.vehicleChargePauseStateId)
        ? pauseRead
            ? (0, quality_1.normalizeOptionalBoolOrNull)(pauseRead.val)
            : null
        : null;
    const planEnabled = planEnabledRead ? (0, quality_1.normalizeOptionalBoolOrNull)(planEnabledRead.val) : null;
    const deadlineFromSource = deadlineRead && deadlineRead.val != null && deadlineRead.val !== ""
        ? (0, smart_plan_parse_1.resolveDeadlineIso)(String(deadlineRead.val), opts.now, opts.timezone)
        : null;
    const deadlineIso = deadlineFromSource ?? (0, smart_plan_parse_1.resolveDeadlineIso)(opts.configDepartureAt, opts.now, opts.timezone);
    const smartPlan = buildSmartPlanEval({
        mappingConfigured: planMappingConfigured,
        planRead,
        startRead,
        endRead,
        planEnabled,
        nowMs,
        deadlineIso,
        fallbackMaxAcKw: opts.fallbackMaxAcKw,
    });
    const updatedAtMs = maxTs([
        controlRead?.tsMs ?? null,
        rewardsRead?.tsMs ?? null,
        chargingRead?.tsMs ?? null,
        planRead?.tsMs ?? null,
        planEnabledRead?.tsMs ?? null,
        startRead?.tsMs ?? null,
        endRead?.tsMs ?? null,
        deadlineRead?.tsMs ?? null,
        heartbeatRead?.tsMs ?? null,
        minSocRead?.tsMs ?? null,
    ]);
    const freshnessConfigured = mapped(foundation.externalSourceUpdatedAtStateId);
    let freshnessMs = null;
    if (heartbeatRead) {
        const fromValue = (0, smart_plan_parse_1.parseTimestampToMs)(heartbeatRead.val);
        freshnessMs = fromValue ?? heartbeatRead.tsMs;
    }
    const stale = freshnessConfigured && heartbeatRead != null
        ? (0, quality_1.isStale)(freshnessMs, nowMs, foundation.externalSourceStaleAfterMin)
        : false;
    const anyMappedMissing = (controlMapped && controlRead === null) ||
        (rewardsMapped && rewardsRead === null) ||
        (chargingMapped && chargingRead === null) ||
        (planMappingConfigured && planRead === null && !(startRead && endRead));
    const anyMappedReadable = controlRead != null ||
        rewardsRead != null ||
        chargingRead != null ||
        planRead != null ||
        (startRead != null && endRead != null);
    const controlInvalid = controlMapped && controlRead != null && externalControlActive === null;
    const planInvalid = planMappingConfigured && smartPlan.stateReadable && !smartPlan.payloadParseable;
    const planDegraded = smartPlan.ignoredSlotCount > 0 ||
        smartPlan.remainingEnergyEstimated ||
        (smartPlan.payloadParseable && !smartPlan.validPlanPresent);
    const quality = (0, quality_1.resolveExternalSourceQuality)({
        configured,
        anyMappedReadable,
        anyMappedMissing,
        controlInvalid,
        planInvalid,
        planDegraded,
        stale,
    });
    const minSocMapped = mapped(foundation.externalSmartChargingMinSocStateId);
    const minSocPct = minSocRead ? (0, quality_1.normalizeOptionalSocOrNull)(minSocRead.val) : null;
    return {
        externalControlConfigured: configured,
        externalControlEnabled: controlEnabled,
        externalControlActive,
        externalControlType: foundation.externalControlType,
        gridRewardsActive,
        smartChargingActive,
        externalSourceHealthy: (0, quality_1.sourceIsHealthy)(quality),
        externalSourceQuality: quality,
        externalSourceUpdatedAt: updatedAtMs != null ? (0, time_1.isoFromMs)(updatedAtMs) : null,
        vehicleChargePauseDiagnostic,
        smartPlan,
        externalTargetSocPct: targetRead ? (0, quality_1.normalizeOptionalSocOrNull)(targetRead.val) : null,
        externalSmartChargingMinSocPct: minSocPct,
        externalSmartChargingMinSocQuality: !minSocMapped
            ? "unconfigured"
            : minSocPct !== null
                ? "valid"
                : "unknown",
        freshnessSignalConfigured: freshnessConfigured,
    };
}
exports.readExternalEvInformation = readExternalEvInformation;
function timezoneFromAdapterConfig(config) {
    return (0, config_1.intentAdminConfigFromAdapter)(config).timezone;
}
exports.timezoneFromAdapterConfig = timezoneFromAdapterConfig;
var smart_plan_parse_2 = require("./smart_plan_parse");
Object.defineProperty(exports, "parseSmartPlanPayload", { enumerable: true, get: function () { return smart_plan_parse_2.parseSmartPlanPayload; } });
Object.defineProperty(exports, "parseStandaloneStartEnd", { enumerable: true, get: function () { return smart_plan_parse_2.parseStandaloneStartEnd; } });
Object.defineProperty(exports, "parseTimestampToMs", { enumerable: true, get: function () { return smart_plan_parse_2.parseTimestampToMs; } });
Object.defineProperty(exports, "resolveDeadlineIso", { enumerable: true, get: function () { return smart_plan_parse_2.resolveDeadlineIso; } });
var remaining_energy_2 = require("./remaining_energy");
Object.defineProperty(exports, "computeExternalPlanRemainingEnergy", { enumerable: true, get: function () { return remaining_energy_2.computeExternalPlanRemainingEnergy; } });
Object.defineProperty(exports, "currentOrFutureSlots", { enumerable: true, get: function () { return remaining_energy_2.currentOrFutureSlots; } });
var quality_2 = require("./quality");
Object.defineProperty(exports, "externalControlEnabledFromConfig", { enumerable: true, get: function () { return quality_2.externalControlEnabledFromConfig; } });
Object.defineProperty(exports, "normalizeSmartChargingActive", { enumerable: true, get: function () { return quality_2.normalizeSmartChargingActive; } });
Object.defineProperty(exports, "resolveExternalSourceQuality", { enumerable: true, get: function () { return quality_2.resolveExternalSourceQuality; } });
__exportStar(require("./types"), exports);
