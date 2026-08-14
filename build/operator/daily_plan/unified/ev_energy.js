"use strict";
/**
 * EV energy classes for Unified (Phase 4).
 *
 * Units:
 * - vehicle usable kWh = capacity × ΔSOC/100
 * - required AC input kWh = usable / chargingEfficiency  (Phase 3)
 *   OR usable × chargeLossFactor (legacy Unified fixtures, typically 1.05)
 *
 * Never apply both. Tibber/external smart-charging minimum is never Hard.
 * No deadline → Hard = 0 (target energy remains Soft).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEvPlannerDiagnosis = exports.totalEvAcNeedKwh = exports.parseExternalReservations = exports.overlapHours = exports.evDispatchWallboxEntries = exports.evEmsAllocates = exports.evManagementFromWallbox = exports.resolveEvManagementMode = exports.resolveEvEnergyClasses = exports.toAcInputKwh = exports.WALLBOX_TARGET_CONSUMER_ID = exports.WALLBOX_HARD_CONSUMER_ID = exports.EV_PLANNER_ROLE = void 0;
const energy_1 = require("../../../addons/wallbox/ev_foundation/decision/energy");
exports.EV_PLANNER_ROLE = "electric_vehicle";
exports.WALLBOX_HARD_CONSUMER_ID = "wallbox";
exports.WALLBOX_TARGET_CONSUMER_ID = "wallbox_target";
function toAcInputKwh(input) {
    if (input.usableKwh == null || !Number.isFinite(input.usableKwh))
        return null;
    if (input.chargingEfficiency != null && input.chargingEfficiency > 0) {
        return (0, energy_1.roundKwh)(input.usableKwh / input.chargingEfficiency);
    }
    const loss = input.chargeLossFactor != null && input.chargeLossFactor > 0 ? input.chargeLossFactor : 1;
    return (0, energy_1.roundKwh)(Math.max(0, input.usableKwh) * loss);
}
exports.toAcInputKwh = toAcInputKwh;
function resolveEvEnergyClasses(wb) {
    const preHard = wb.hardRequiredEnergyKwh;
    const preTarget = wb.targetEnergyKwh;
    let targetEnergyKwh = preTarget != null && Number.isFinite(preTarget)
        ? (0, energy_1.roundKwh)(Math.max(0, preTarget))
        : (0, energy_1.energyForSocDeltaKwh)({
            vehicleSocPct: wb.vehicleSocPct,
            targetSocPct: wb.targetSocPct,
            batteryCapacityKWh: wb.vehicleCapacityKwh,
            chargingEfficiency: wb.chargingEfficiency ?? null,
        });
    if (targetEnergyKwh == null && wb.requiredEnergyKwh != null) {
        targetEnergyKwh = toAcInputKwh({
            usableKwh: wb.requiredEnergyKwh,
            chargingEfficiency: wb.chargingEfficiency ?? null,
            chargeLossFactor: wb.chargingEfficiency != null ? 1 : (wb.chargeLossFactor ?? 1),
        });
    }
    let hardRequiredEnergyKwh = 0;
    if (preHard != null && Number.isFinite(preHard)) {
        hardRequiredEnergyKwh = (0, energy_1.roundKwh)(Math.max(0, preHard));
    }
    else if (wb.minimumDepartureSocPct != null &&
        wb.deadlineIso &&
        wb.vehicleSocPct != null &&
        wb.vehicleCapacityKwh != null) {
        const ac = (0, energy_1.energyForSocDeltaKwh)({
            vehicleSocPct: wb.vehicleSocPct,
            targetSocPct: wb.minimumDepartureSocPct,
            batteryCapacityKWh: wb.vehicleCapacityKwh,
            chargingEfficiency: wb.chargingEfficiency ?? null,
        });
        if (ac != null)
            hardRequiredEnergyKwh = ac;
        else {
            const usable = (Math.max(0, wb.minimumDepartureSocPct - wb.vehicleSocPct) / 100) * wb.vehicleCapacityKwh;
            hardRequiredEnergyKwh =
                toAcInputKwh({
                    usableKwh: usable,
                    chargingEfficiency: null,
                    chargeLossFactor: wb.chargeLossFactor ?? 1,
                }) ?? 0;
        }
    }
    else if (wb.energyGoalHard === true && wb.deadlineIso && wb.requiredEnergyKwh != null) {
        /* Legacy fixtures: explicit hard goal + deadline + requiredEnergy. */
        hardRequiredEnergyKwh =
            toAcInputKwh({
                usableKwh: wb.requiredEnergyKwh,
                chargingEfficiency: wb.chargingEfficiency ?? null,
                chargeLossFactor: wb.chargingEfficiency != null ? 1 : (wb.chargeLossFactor ?? 1),
            }) ?? 0;
    }
    const insufficientData = wb.vehicleSocPct == null &&
        preTarget == null &&
        preHard == null &&
        wb.requiredEnergyKwh == null &&
        wb.fallbackEnergyNeedKwh == null;
    if (insufficientData) {
        return {
            hardRequiredEnergyKwh: 0,
            targetEnergyKwh: null,
            targetFlexEnergyKwh: 0,
            energyUnit: "ac_input_kwh",
            energyGoalHard: false,
            insufficientData: true,
        };
    }
    /** Keine echte Deadline → keine Hard-Energie (auch wenn ein Pre-Wert gemappt wurde). */
    if (!wb.deadlineIso) {
        hardRequiredEnergyKwh = 0;
    }
    const targetFlexEnergyKwh = targetEnergyKwh == null ? 0 : (0, energy_1.roundKwh)(Math.max(0, targetEnergyKwh - hardRequiredEnergyKwh));
    return {
        hardRequiredEnergyKwh,
        targetEnergyKwh,
        targetFlexEnergyKwh,
        energyUnit: "ac_input_kwh",
        energyGoalHard: hardRequiredEnergyKwh > 0 && Boolean(wb.deadlineIso),
        insufficientData: false,
    };
}
exports.resolveEvEnergyClasses = resolveEvEnergyClasses;
function resolveEvManagementMode(input) {
    if (!input.connectedNow && !input.hasAllocatablePresence)
        return "unavailable";
    const sev = input.takeoverSeverity ?? "none";
    if (sev === "recommended" || sev === "required")
        return "takeover_candidate";
    const auth = input.externalAuthorityState ?? "";
    if (auth === "active" || auth === "planned" || auth === "active_without_plan") {
        if (sev === "none" || sev === "observe" || sev === "")
            return "externally_managed";
    }
    return "ems_candidate";
}
exports.resolveEvManagementMode = resolveEvManagementMode;
function evManagementFromWallbox(wb) {
    if (!wb)
        return "unavailable";
    if (wb.managementMode)
        return wb.managementMode;
    const hasPresence = wb.presenceWindows.some((w) => {
        const status = w.status ?? (w.available ? "available" : "unavailable");
        return status === "available";
    });
    return resolveEvManagementMode({
        connectedNow: wb.connectedNow,
        hasAllocatablePresence: hasPresence,
        externalAuthorityState: wb.externalAuthorityState,
        takeoverSeverity: wb.takeoverSeverity,
    });
}
exports.evManagementFromWallbox = evManagementFromWallbox;
/** EMS may allocate EV energy (still planning-only for new writes). */
function evEmsAllocates(mode) {
    return mode === "ems_candidate" || mode === "takeover_candidate";
}
exports.evEmsAllocates = evEmsAllocates;
/** Executable daily-plan wallbox slice — not for external/takeover-candidate. */
function evDispatchWallboxEntries(mode) {
    return mode === "ems_candidate";
}
exports.evDispatchWallboxEntries = evDispatchWallboxEntries;
function overlapHours(a0, a1, b0, b1) {
    const lo = Math.max(a0, b0);
    const hi = Math.min(a1, b1);
    if (!(hi > lo))
        return 0;
    return (hi - lo) / 3_600_000;
}
exports.overlapHours = overlapHours;
function reservationQuality(raw) {
    if (raw === "ok" || raw === "degraded" || raw === "unknown")
        return raw;
    return "unknown";
}
/** Neutral smart-plan slots → Unified reservations. Never vendor state IDs. */
function parseExternalReservations(raw) {
    let list = [];
    if (typeof raw === "string" && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed))
                list = parsed;
            else if (parsed && typeof parsed === "object" && Array.isArray(parsed.slots)) {
                list = parsed.slots;
            }
        }
        catch {
            return [];
        }
    }
    else if (Array.isArray(raw)) {
        list = raw;
    }
    const out = [];
    for (const item of list) {
        if (!item || typeof item !== "object")
            continue;
        const o = item;
        const startIso = typeof o.startIso === "string" ? o.startIso : typeof o.start === "string" ? o.start : null;
        const endIso = typeof o.endIso === "string" ? o.endIso : typeof o.end === "string" ? o.end : null;
        if (!startIso || !endIso)
            continue;
        const powerRaw = o.powerW ?? o.plannedPowerW ?? (typeof o.plannedPowerKw === "number" ? o.plannedPowerKw * 1000 : null);
        const energyRaw = o.energyKwh ?? o.plannedEnergyKWh ?? o.plannedEnergyKwh;
        const powerW = typeof powerRaw === "number" && Number.isFinite(powerRaw) ? powerRaw : null;
        const energyKwh = typeof energyRaw === "number" && Number.isFinite(energyRaw) ? energyRaw : null;
        out.push({
            startIso,
            endIso,
            powerW,
            energyKwh,
            quality: reservationQuality(o.quality),
        });
    }
    return out;
}
exports.parseExternalReservations = parseExternalReservations;
function totalEvAcNeedKwh(classes) {
    if (classes.insufficientData)
        return null;
    if (classes.targetEnergyKwh == null && classes.hardRequiredEnergyKwh <= 0)
        return null;
    return (0, energy_1.roundKwh)(classes.hardRequiredEnergyKwh + classes.targetFlexEnergyKwh);
}
exports.totalEvAcNeedKwh = totalEvAcNeedKwh;
function buildEvPlannerDiagnosis(input) {
    const wb = input.wallbox;
    if (!wb)
        return null;
    const classes = resolveEvEnergyClasses(wb);
    const mode = evManagementFromWallbox(wb);
    const wbAlloc = input.allocations.filter((a) => a.kind === "wallbox");
    let pv = 0;
    let grid = 0;
    let costCt = 0;
    let priced = 0;
    let first = null;
    let last = null;
    const planSlots = [];
    for (const a of wbAlloc) {
        if (a.energySource === "pv_surplus")
            pv += a.allocatedEnergyKwh;
        if (a.energySource === "grid" || a.energySource === "mixed")
            grid += a.allocatedEnergyKwh;
        const slot = input.slots.find((s) => s.startIso === a.slot.startIso);
        if ((a.energySource === "grid" || a.energySource === "mixed") && slot?.importCt != null) {
            costCt += a.allocatedEnergyKwh * slot.importCt;
            priced += a.allocatedEnergyKwh;
        }
        if (!first || a.slot.startIso < first)
            first = a.slot.startIso;
        if (!last || a.slot.endIso > last)
            last = a.slot.endIso;
        planSlots.push({
            startIso: a.slot.startIso,
            endIso: a.slot.endIso,
            energyKwh: a.allocatedEnergyKwh,
            source: a.energySource,
            consumerId: a.consumerId,
            reasonCodes: a.reasonCodes,
        });
    }
    const planned = (0, energy_1.roundKwh)(pv + grid);
    const acNeed = totalEvAcNeedKwh(classes);
    const unplanned = mode === "externally_managed"
        ? null
        : acNeed == null
            ? null
            : (0, energy_1.roundKwh)(Math.max(0, acNeed - planned));
    const participating = mode !== "unavailable" &&
        (planned > 0 ||
            (wb.externalReservations?.length ?? 0) > 0 ||
            (classes.hardRequiredEnergyKwh > 0 || (classes.targetEnergyKwh ?? 0) > 0));
    let planQuality = "ok";
    if (wb.externalPlanQuality === "degraded" || wb.uncertainty.status === "degraded")
        planQuality = "degraded";
    if (classes.insufficientData || wb.socSource === "unknown" || wb.externalPlanQuality === "unknown") {
        planQuality = planQuality === "ok" ? "unknown" : planQuality;
    }
    const reservations = (wb.externalReservations ?? []).map((r) => ({
        startIso: r.startIso,
        endIso: r.endIso,
        powerW: r.powerW,
        energyKwh: r.energyKwh,
        quality: r.quality,
        kind: "external_reservation",
    }));
    return {
        participating,
        role: exports.EV_PLANNER_ROLE,
        managementMode: mode,
        hardEnergyKwh: classes.hardRequiredEnergyKwh,
        targetEnergyKwh: classes.targetEnergyKwh,
        acEnergyRequiredKwh: acNeed,
        plannedEnergyKwh: planned,
        unplannedEnergyKwh: unplanned,
        plannedCostEur: grid <= 0 ? 0 : Math.abs(priced - grid) <= 0.05 ? (0, energy_1.roundKwh)(costCt / 100) : null,
        plannedPvEnergyKwh: (0, energy_1.roundKwh)(pv),
        plannedGridEnergyKwh: (0, energy_1.roundKwh)(grid),
        plannedFirstStart: first,
        plannedLastEnd: last,
        planQuality,
        externalAuthorityState: wb.externalAuthorityState ?? null,
        takeoverSeverity: wb.takeoverSeverity ?? null,
        explain: {
            energyUnit: classes.energyUnit,
            insufficientData: classes.insufficientData,
            energyGoalHard: classes.energyGoalHard,
            targetFlexEnergyKwh: classes.targetFlexEnergyKwh,
            connectedNow: wb.connectedNow,
            vehicleSocPct: wb.vehicleSocPct,
            targetSocPct: wb.targetSocPct,
            minimumDepartureSocPct: wb.minimumDepartureSocPct ?? null,
            externalSmartChargingMinSocPct: wb.externalSmartChargingMinSocPct ?? null,
            deadlineIso: wb.deadlineIso,
            maxChargePowerW: wb.maxChargePowerW,
            chargingEfficiency: wb.chargingEfficiency ?? null,
            chargeLossFactor: wb.chargingEfficiency != null ? 1 : (wb.chargeLossFactor ?? 1),
            externalReservations: reservations,
            emsSlots: planSlots,
            dispatchPrepared: evDispatchWallboxEntries(mode),
        },
    };
}
exports.buildEvPlannerDiagnosis = buildEvPlannerDiagnosis;
