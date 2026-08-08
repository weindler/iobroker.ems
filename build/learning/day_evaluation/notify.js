"use strict";
/**
 * Notification-Candidate-Contract (Schritt 7) — keine Push-Integration.
 * Nur materiell relevante Kandidaten; Dedup-Key gegen Event-Spam.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeNotificationCandidates = exports.buildNotificationCandidates = void 0;
const MATERIAL_PV_COLLAPSE_KWH = 4;
const MATERIAL_GRID_CHARGE_KWH = 1;
const MATERIAL_SAVINGS_CT = 20;
function buildNotificationCandidates(input) {
    const out = [];
    const { plan, date, nowIso } = input;
    const eco = plan.vehicleChargeEconomics;
    const conf = plan.confidence.confidencePct;
    const wallboxGoal = plan.goalStatuses.find((g) => g.consumerId === "wallbox");
    const gridKwh = eco?.expectedGridChargeKwh ?? 0;
    const pvKwh = eco?.expectedPvChargeKwh ?? 0;
    if (gridKwh >= MATERIAL_GRID_CHARGE_KWH && eco) {
        const savings = eco.savingsVsAlternativeCt !== null && eco.economicsCompleteness !== "unknown"
            ? eco.savingsVsAlternativeCt
            : null;
        out.push({
            schemaVersion: 1,
            kind: "vehicle_grid_charge_recommended",
            dedupKey: `vehicle_grid_charge_recommended|${date}|wallbox`,
            date,
            createdAtIso: nowIso,
            confidencePct: conf,
            payload: {
                requiredEnergyKwh: eco.requiredEnergyKwh,
                requiredGridKwh: eco.expectedGridChargeKwh,
                plannedPvKwh: eco.expectedPvChargeKwh,
                deadlineIso: eco.deadlineIso,
                expectedCostCt: eco.expectedGridCostCt,
                baselineCostCt: eco.alternativeGridCostCt,
                savingsCt: savings,
                economicsCompleteness: eco.economicsCompleteness,
            },
            reasonDe: savings !== null
                ? `Netzladung ${gridKwh.toFixed(1)} kWh geplant; Ersparnis vs. earliest_feasible ${(savings / 100).toFixed(2)} €.`
                : `Netzladung ${gridKwh.toFixed(1)} kWh geplant; Ersparnis nicht vollständig berechenbar.`,
        });
    }
    if (wallboxGoal &&
        (wallboxGoal.met === null || wallboxGoal.met === false) &&
        plan.reasonCodes.some((c) => c.includes("at_risk") ||
            c.includes("unreachable") ||
            c.includes("presence_unknown"))) {
        out.push({
            schemaVersion: 1,
            kind: "vehicle_goal_at_risk",
            dedupKey: `vehicle_goal_at_risk|${date}|wallbox`,
            date,
            createdAtIso: nowIso,
            confidencePct: conf,
            payload: {
                requiredEnergyKwh: eco?.requiredEnergyKwh ?? null,
                plannedPvKwh: pvKwh,
                plannedGridKwh: gridKwh,
                deadlineIso: eco?.deadlineIso ?? null,
                goalDetailDe: wallboxGoal.detailDe,
                met: wallboxGoal.met,
            },
            reasonDe: wallboxGoal.detailDe || "Fahrzeugziel gefährdet oder unsicher.",
        });
    }
    const prev = input.previousExpectedPvKwh;
    const cur = plan.expectedPvEnergyKwh;
    if (prev !== null &&
        prev !== undefined &&
        cur !== null &&
        Number.isFinite(prev) &&
        Number.isFinite(cur) &&
        prev - cur >= MATERIAL_PV_COLLAPSE_KWH) {
        out.push({
            schemaVersion: 1,
            kind: "forecast_collapse",
            dedupKey: `forecast_collapse|${date}|pv`,
            date,
            createdAtIso: nowIso,
            confidencePct: conf,
            payload: {
                previousPvKwh: prev,
                newPvKwh: cur,
                deltaKwh: Math.round((cur - prev) * 1000) / 1000,
                affectedGoals: plan.goalStatuses
                    .filter((g) => g.met !== true)
                    .map((g) => `${g.consumerId}.${g.goalId}`),
            },
            reasonDe: `PV-Prognose um ${(prev - cur).toFixed(1)} kWh eingebrochen — Plan angepasst.`,
        });
    }
    else if (prev !== null &&
        prev !== undefined &&
        cur !== null &&
        Math.abs(cur - prev) < MATERIAL_PV_COLLAPSE_KWH) {
        // kleine Schwankung → kein Candidate (NOTIFY-002)
    }
    if (prev !== null &&
        prev !== undefined &&
        cur !== null &&
        cur - prev >= MATERIAL_PV_COLLAPSE_KWH) {
        out.push({
            schemaVersion: 1,
            kind: "unexpected_surplus",
            dedupKey: `unexpected_surplus|${date}|pv`,
            date,
            createdAtIso: nowIso,
            confidencePct: conf,
            payload: {
                additionalPvKwh: Math.round((cur - prev) * 1000) / 1000,
                flexBatteryKwh: sumKind(plan, "battery_charge"),
                flexImmersionKwh: sumKind(plan, "immersion_heater"),
                flexWallboxKwh: sumKind(plan, "wallbox"),
                expectedExportKwh: plan.expectedGridExportEnergyKwh,
            },
            reasonDe: `Zusätzliche PV ${(cur - prev).toFixed(1)} kWh — Flex vor Export genutzt.`,
        });
    }
    const ev = input.evaluation;
    if (ev) {
        for (const g of ev.goals) {
            if (g.status === "missed") {
                out.push({
                    schemaVersion: 1,
                    kind: "goal_missed",
                    dedupKey: `goal_missed|${date}|${g.consumerId}|${g.goalId}`,
                    date,
                    createdAtIso: nowIso,
                    confidencePct: null,
                    payload: {
                        goal: `${g.consumerId}.${g.goalId}`,
                        reasonCodes: g.reasonCodes,
                        vehicle: ev.vehicle,
                    },
                    reasonDe: `Ziel ${g.consumerId}.${g.goalId} verfehlt.`,
                });
            }
        }
    }
    if (plan.reasonCodes.includes("battery_telemetry_missing") ||
        plan.reasonCodes.includes("pv_forecast_degraded") ||
        plan.confidence.status === "missing") {
        out.push({
            schemaVersion: 1,
            kind: "planning_data_missing",
            dedupKey: `planning_data_missing|${date}|core`,
            date,
            createdAtIso: nowIso,
            confidencePct: conf,
            payload: { reasonCodes: plan.reasonCodes.filter((c) => c.includes("missing") || c.includes("degraded")) },
            reasonDe: "Wichtige Planungsdaten fehlen oder sind degraded.",
        });
    }
    // Dedup innerhalb eines Builds
    const byKey = new Map();
    for (const c of out) {
        if (!byKey.has(c.dedupKey))
            byKey.set(c.dedupKey, c);
    }
    void MATERIAL_SAVINGS_CT;
    return [...byKey.values()];
}
exports.buildNotificationCandidates = buildNotificationCandidates;
function sumKind(plan, kind) {
    return Math.round(plan.allocations.filter((a) => a.kind === kind).reduce((s, a) => s + a.allocatedEnergyKwh, 0) *
        1000) / 1000;
}
/** Merge-Helfer: gleiche Dedup-Keys nicht verdoppeln (Replan-Spam). */
function mergeNotificationCandidates(existing, incoming) {
    const map = new Map();
    for (const c of existing)
        map.set(c.dedupKey, c);
    for (const c of incoming) {
        if (!map.has(c.dedupKey))
            map.set(c.dedupKey, c);
    }
    return [...map.values()];
}
exports.mergeNotificationCandidates = mergeNotificationCandidates;
