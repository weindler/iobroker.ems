"use strict";
/**
 * Deterministische, maschinenlesbare Tagesplan-Erklärung (Schritt 7 §13).
 * KI formuliert daraus Text — erfindet keine Zahlen.
 *
 * Scope-Semantik:
 * - `heute.*` = Day Scope (lokaler Kalendertag)
 * - `horizon.*` = Planning Horizon (Rest-Unified-Horizont)
 * - `fahrzeug.*` = Goal Scope (Deadline-/Zielbezogen)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDeterministicDayExplanation = void 0;
const energy_scopes_1 = require("../../operator/daily_plan/unified/energy_scopes");
const time_1 = require("../../operator/time");
function sumKind(plan, kind) {
    return plan.allocations
        .filter((a) => a.kind === kind)
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
function sumKindOnLocalDay(plan, kind, dateKey) {
    return plan.allocations
        .filter((a) => a.kind === kind && (0, energy_scopes_1.localDateKeyFromIso)(a.slot.startIso, plan.timezone) === dateKey)
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
function batterySocAtLocalDayEnd(plan, dateKey, fallbackStart) {
    const traj = plan.batteryTrajectory;
    if (!traj.length)
        return fallbackStart ?? null;
    let lastToday = null;
    for (const p of traj) {
        if ((0, energy_scopes_1.localDateKeyFromIso)(p.slotStartIso, plan.timezone) === dateKey && p.socPct !== null) {
            lastToday = p.socPct;
        }
    }
    if (lastToday !== null)
        return lastToday;
    return traj[traj.length - 1]?.socPct ?? fallbackStart ?? null;
}
function buildDeterministicDayExplanation(plan, opts) {
    const eco = plan.vehicleChargeEconomics;
    const ih = plan.allocations.filter((a) => a.kind === "immersion_heater");
    const ac = plan.allocations.filter((a) => a.kind === "climate");
    const batTraj = plan.batteryTrajectory;
    const dateKey = (0, time_1.localDateKeyInTimezone)(new Date(Date.parse(plan.createdAtIso) || Date.now()), plan.timezone);
    const risks = [];
    for (const c of plan.reasonCodes) {
        if (c.includes("degraded") ||
            c.includes("unknown") ||
            c.includes("at_risk") ||
            c.includes("unsupported") ||
            c.includes("missing") ||
            c === "export_tariff_unknown" ||
            c === "vehicle_presence_unknown") {
            risks.push(c);
        }
    }
    for (const g of plan.goalStatuses) {
        if (g.met === false || g.met === null) {
            risks.push(`goal_${g.consumerId}_${g.goalId}_${g.met === false ? "missed" : "unknown"}`);
        }
    }
    if (eco?.economicsCompleteness === "unknown" || eco?.savingsVsAlternativeCt === null) {
        if (eco && eco.expectedGridChargeKwh && eco.expectedGridChargeKwh > 0) {
            risks.push("vehicle_savings_incomplete");
        }
    }
    if (!eco?.exportTariffKnown)
        risks.push("export_tariff_unknown");
    const availabilityNotes = [];
    for (const c of plan.reasonCodes) {
        if (c.startsWith("vehicle_presence") || c.startsWith("vehicle_goal")) {
            availabilityNotes.push(c);
        }
    }
    const flexToday = sumKindOnLocalDay(plan, "immersion_heater", dateKey) +
        sumKindOnLocalDay(plan, "climate", dateKey) +
        sumKindOnLocalDay(plan, "wallbox", dateKey) +
        sumKindOnLocalDay(plan, "battery_charge", dateKey);
    return {
        schemaVersion: 1,
        date: dateKey,
        timezone: plan.timezone,
        planId: plan.planId,
        heute: {
            pvExpectedKwh: plan.expectedPvEnergyTodayKwh,
            houseLoadExpectedKwh: plan.expectedHouseLoadEnergyTodayKwh,
            batteryStartSocPct: opts?.batteryStartSocPct ?? batTraj[0]?.socPct ?? null,
            batteryEndSocPct: batterySocAtLocalDayEnd(plan, dateKey, opts?.batteryStartSocPct),
            flexibleAllocatedKwh: Math.round(flexToday * 1000) / 1000,
            // Import/Export/Cost am Plan sind Horizon-Aggregate — nicht unter „heute“ spiegeln.
            expectedImportKwh: null,
            expectedExportKwh: null,
            expectedCostCt: null,
        },
        horizon: {
            pvExpectedKwh: plan.expectedPvEnergyHorizonKwh,
            houseLoadExpectedKwh: plan.expectedHouseLoadEnergyHorizonKwh,
            expectedImportKwh: plan.expectedGridImportEnergyKwh,
            expectedExportKwh: plan.expectedGridExportEnergyKwh,
            expectedCostCt: plan.expectedCostCt,
        },
        heizstab: {
            // Geplante Fenster über den Horizon (nicht nur heute) — Texte ohne „Heute“-Label.
            windows: ih.map((a) => ({
                startIso: a.slot.startIso,
                endIso: a.slot.endIso,
                energyKwh: a.allocatedEnergyKwh,
                powerW: a.allocatedPowerW,
            })),
            totalKwh: Math.round(sumKind(plan, "immersion_heater") * 1000) / 1000,
            reasonCodes: [...new Set(ih.flatMap((a) => a.reasonCodes))],
        },
        klima: {
            windows: ac.map((a) => ({
                startIso: a.slot.startIso,
                endIso: a.slot.endIso,
                energyKwh: a.allocatedEnergyKwh,
                unitId: a.consumerId,
            })),
            totalKwh: Math.round(sumKind(plan, "climate") * 1000) / 1000,
            reasonCodes: [...new Set(ac.flatMap((a) => a.reasonCodes))],
        },
        fahrzeug: {
            requiredEnergyKwh: eco?.requiredEnergyKwh ?? null,
            deadlineIso: eco?.deadlineIso ?? null,
            plannedPvKwh: eco?.expectedPvChargeKwh ?? null,
            plannedGridKwh: eco?.expectedGridChargeKwh ?? null,
            expectedGridCostCt: eco?.expectedGridCostCt ?? null,
            earliestFeasibleCostCt: eco?.alternativeGridCostCt ?? null,
            savingsCt: eco?.savingsVsAlternativeCt ?? null,
            economicsCompleteness: eco?.economicsCompleteness ?? null,
            pvToGoalKwh: plan.expectedPvEnergyToGoalKwh,
            availabilityNotes,
        },
        risiken: [...new Set(risks)],
        goals: plan.goalStatuses.map((g) => ({
            consumerId: g.consumerId,
            goalId: g.goalId,
            met: g.met,
            detailDe: g.detailDe,
        })),
        reasonCodes: [...plan.reasonCodes],
    };
}
exports.buildDeterministicDayExplanation = buildDeterministicDayExplanation;
