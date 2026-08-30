"use strict";
/**
 * Kompakter PlannerKnowledgeSnapshot + Content-Hash Dedup.
 * Bewusst kleiner als voller UnifiedDayPlannerInput.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertForecastSnapshot = exports.withSnapshotId = exports.hashPlannerKnowledgeContent = exports.buildPlannerKnowledgeSnapshot = void 0;
const node_crypto_1 = require("node:crypto");
const time_1 = require("../../operator/time");
function digestPresence(windows) {
    if (!windows?.length)
        return null;
    return windows
        .map((w) => `${w.available ? 1 : 0}:${w.startIso}:${w.endIso}`)
        .join("|")
        .slice(0, 512);
}
function deriveBatteryDecisionSnapshot(ctx) {
    if (!ctx)
        return null;
    if (ctx.holdActive) {
        return {
            action: "hold",
            dischargeAllowed: ctx.dischargeAllowed,
            requiredSocAtPvEndPct: ctx.requiredSocAtPvEndPct,
            holdActive: true,
            reasonCode: "battery_hold_active",
        };
    }
    if (ctx.dischargeAllowed) {
        return {
            action: "discharge_allowed",
            dischargeAllowed: true,
            requiredSocAtPvEndPct: ctx.requiredSocAtPvEndPct,
            holdActive: false,
            reasonCode: "price_and_reserve_ok",
        };
    }
    let reasonCode = "soc_below_reserve";
    if (ctx.requiredSocAtPvEndPct === null)
        reasonCode = "reserve_unknown";
    else if (!ctx.priceAllowed)
        reasonCode = "price_blocked";
    else if (!ctx.socAllowed)
        reasonCode = "soc_unknown";
    return {
        action: "discharge_blocked",
        dischargeAllowed: false,
        requiredSocAtPvEndPct: ctx.requiredSocAtPvEndPct,
        holdActive: false,
        reasonCode,
    };
}
/** Extrahiert minimalen Wissens-Snapshot aus Planner-Input. */
function buildPlannerKnowledgeSnapshot(input, tsIso, extra) {
    const timezone = input.time?.timezone?.trim() || "Europe/Berlin";
    const nowMs = Date.parse(input.time?.nowIso ?? tsIso);
    const date = Number.isFinite(nowMs) ? (0, time_1.localDateKeyInTimezone)(new Date(nowMs), timezone) : "";
    const priceSlots = [];
    for (const s of input.prices?.slots ?? []) {
        const startMs = Date.parse(s.slot.startIso);
        const ct = s.importCtPerKwh;
        if (!Number.isFinite(startMs) || ct == null || !Number.isFinite(ct))
            continue;
        priceSlots.push([startMs, ct]);
    }
    const pvSlotKwh = [];
    for (const s of input.pv?.slots ?? []) {
        const startMs = Date.parse(s.slot.startIso);
        const kwh = s.energyKwh;
        if (!Number.isFinite(startMs) || kwh == null || !Number.isFinite(kwh))
            continue;
        pvSlotKwh.push([startMs, kwh]);
    }
    const climateUnits = input.climate?.units.map((u) => ({
        consumerId: u.unitId,
        sharedPowerGroupId: u.sharedPowerGroupId?.trim() || null,
        mandatory: u.mandatoryComfort === true,
        mode: null,
    })) ?? [];
    return {
        tsIso,
        date,
        timezone,
        globalMode: input.globalMode ?? "",
        contributionRevision: input.contributionRevision ?? null,
        pvExpectedDayKwh: input.pv?.expectedDayEnergyKwh ?? null,
        houseLoadExpectedDayKwh: input.houseLoad?.expectedDayEnergyKwh ?? null,
        batterySocPct: input.battery?.socPct ?? null,
        batteryCapacityKwh: input.battery?.usableCapacityKwh ?? null,
        batteryNightReserveKwh: input.battery?.nightReserveKwh ?? null,
        priceSlots,
        pvSlotKwh,
        wallboxRequiredEnergyKwh: input.wallbox?.requiredEnergyKwh ?? null,
        wallboxDeadlineIso: input.wallbox?.deadlineIso ?? null,
        wallboxConnected: input.wallbox?.connectedNow ?? null,
        wallboxPresenceDigest: digestPresence(input.wallbox?.presenceWindows),
        thermalBufferTempC: input.thermal?.bufferTempC ?? null,
        thermalEmptyAtIso: input.thermal?.estimatedEmptyAtIso ?? null,
        thermalHeadroomKwh: input.thermal?.headroomEnergyKwh ?? null,
        climateUnits,
        wallboxTargetSocPct: input.wallbox?.targetSocPct ?? null,
        wallboxMinimumDepartureSocPct: input.wallbox?.minimumDepartureSocPct ?? null,
        wallboxEnergyGoalHard: input.wallbox?.energyGoalHard ?? null,
        wallboxManagementMode: input.wallbox?.managementMode ?? null,
        batteryDecision: deriveBatteryDecisionSnapshot(extra?.batteryDecision),
    };
}
exports.buildPlannerKnowledgeSnapshot = buildPlannerKnowledgeSnapshot;
/** Content-Hash über Snapshot ohne id/tsIso (tsIso ändert sich bei gleichem Inhalt). */
function hashPlannerKnowledgeContent(snap) {
    const { tsIso: _t, ...rest } = snap;
    const payload = JSON.stringify(rest);
    return (0, node_crypto_1.createHash)("sha256").update(payload).digest("hex").slice(0, 16);
}
exports.hashPlannerKnowledgeContent = hashPlannerKnowledgeContent;
function withSnapshotId(snap) {
    return { ...snap, id: hashPlannerKnowledgeContent(snap) };
}
exports.withSnapshotId = withSnapshotId;
/**
 * Fügt Snapshot nur hinzu, wenn Inhalt neu ist.
 * Returns snapshotId (neu oder bestehend).
 */
function upsertForecastSnapshot(list, snap) {
    const existing = list.find((s) => s.id === snap.id);
    if (existing) {
        return { list, snapshotId: existing.id, inserted: false };
    }
    return { list: [...list, snap], snapshotId: snap.id, inserted: true };
}
exports.upsertForecastSnapshot = upsertForecastSnapshot;
