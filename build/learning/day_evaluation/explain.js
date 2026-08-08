"use strict";
/**
 * Deterministische, maschinenlesbare Tagesplan-Erklärung (Schritt 7 §13).
 * KI formuliert daraus Text — erfindet keine Zahlen.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDeterministicDayExplanation = void 0;
function sumKind(plan, kind) {
    return plan.allocations
        .filter((a) => a.kind === kind)
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
function buildDeterministicDayExplanation(plan, opts) {
    const eco = plan.vehicleChargeEconomics;
    const ih = plan.allocations.filter((a) => a.kind === "immersion_heater");
    const ac = plan.allocations.filter((a) => a.kind === "climate");
    const batTraj = plan.batteryTrajectory;
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
    return {
        schemaVersion: 1,
        date: plan.createdAtIso.slice(0, 10),
        timezone: plan.timezone,
        planId: plan.planId,
        heute: {
            pvExpectedKwh: plan.expectedPvEnergyKwh,
            houseLoadExpectedKwh: plan.expectedHouseLoadEnergyKwh,
            batteryStartSocPct: opts?.batteryStartSocPct ?? batTraj[0]?.socPct ?? null,
            batteryEndSocPct: batTraj.length ? batTraj[batTraj.length - 1]?.socPct ?? null : null,
            flexibleAllocatedKwh: Math.round((sumKind(plan, "immersion_heater") +
                sumKind(plan, "climate") +
                sumKind(plan, "wallbox") +
                sumKind(plan, "battery_charge")) *
                1000) / 1000,
            expectedImportKwh: plan.expectedGridImportEnergyKwh,
            expectedExportKwh: plan.expectedGridExportEnergyKwh,
            expectedCostCt: plan.expectedCostCt,
        },
        heizstab: {
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
