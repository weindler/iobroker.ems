"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const contribution_ids_1 = require("../../contribution_ids");
const addon_plan_publish_1 = require("../addon_plan_publish");
const allocate_1 = require("./allocate");
const alloc_fixtures_1 = require("./alloc_fixtures");
const authority_1 = require("./authority");
const dispatch_bridge_1 = require("./dispatch_bridge");
function classicEntry(contributionId, allocatedPowerW, startIso, endIso) {
    return {
        contributionId,
        contributor: {
            type: "addon",
            id: contributionId.startsWith("air_conditioning") ? "air_conditioning" : "immersion_heater",
            addonId: contributionId.startsWith("air_conditioning") ? "air_conditioning" : "immersion_heater",
        },
        slot: { startIso, endIso },
        status: "allocated",
        energySource: "pv_surplus",
        requestedPowerW: allocatedPowerW,
        allocatedPowerW,
        requestedEnergyKwh: allocatedPowerW / 4000,
        allocatedEnergyKwh: allocatedPowerW / 4000,
        gridPowerW: 0,
        pvPowerW: allocatedPowerW,
        batteryPowerW: 0,
        mandatory: false,
        priorityRank: 1,
        deadlineIso: null,
        estimatedCostCt: null,
        reasonDe: "classic",
    };
}
function basePlan(classicIh, classicAc = []) {
    const bat = classicEntry("battery.charge", 2000, "2026-08-04T10:00:00.000Z", "2026-08-04T10:15:00.000Z");
    bat.contributor = { type: "addon", id: "battery", addonId: "battery" };
    const wb = classicEntry("wallbox.ev_session", 5000, "2026-08-04T11:00:00.000Z", "2026-08-04T11:15:00.000Z");
    wb.contributor = { type: "addon", id: "wallbox", addonId: "wallbox" };
    const allocations = [bat, wb, ...classicIh, ...classicAc];
    return {
        generatedAt: "2026-08-04T08:00:00.000Z",
        validUntil: "2026-08-05T00:00:00.000Z",
        revision: 17,
        date: "2026-08-04",
        timezone: "Europe/Berlin",
        slotMinutes: 15,
        globalMode: "balanced",
        status: "ready",
        policySnapshot: {},
        constraintSnapshot: {},
        activeContributionIds: [],
        excludedContributions: [],
        slots: [
            {
                slot: { startIso: "2026-08-04T10:00:00.000Z", endIso: "2026-08-04T10:15:00.000Z" },
                pvForecastPowerW: 3000,
                fixedHouseLoadPowerW: 500,
                fixedBalancePowerW: 2500,
                gridPriceCtPerKwh: 20,
                gridImportAllowed: true,
                configuredGridImportLimitW: null,
                remainingGridImportPowerW: null,
                availablePvSurplusPowerW: 2500,
                allocatedFlexiblePowerW: 0,
                allocatedPvPowerW: 0,
                allocatedGridPowerW: 0,
                allocatedBatteryPowerW: 0,
                remainingPvSurplusPowerW: 2500,
                remainingGridImportPowerWAfterAlloc: null,
                remainingBatteryDischargePowerW: null,
                allocations: [...allocations],
                quality: { status: "valid", confidencePct: 80, reasonDe: "t" },
                reasonDe: "t",
            },
        ],
        allocations,
        unallocated: [],
        totals: {
            pvForecastEnergyKwh: 10,
            fixedHouseLoadEnergyKwh: 2,
            fixedRenewableBalanceKwh: 8,
            flexibleRequestedEnergyKwh: 5,
            flexibleAllocatedEnergyKwh: 5,
            flexibleUnallocatedEnergyKwh: 0,
            pvAllocatedEnergyKwh: 5,
            gridAllocatedEnergyKwh: 0,
            batteryChargeEnergyKwh: 0.5,
            wallboxEnergyKwh: 1.25,
            immersionHeaterEnergyKwh: 9,
            airConditioningEnergyKwh: 9,
            estimatedGridCostCt: null,
            mandatoryRequestedEnergyKwh: null,
            mandatoryAllocatedEnergyKwh: 0,
            mandatoryUnallocatedEnergyKwh: null,
        },
        quality: { status: "valid", confidencePct: 80, reasonDe: "t" },
        reasonDe: "classic daily plan",
    };
}
(0, node_test_1.describe)("AUTH-001 Unified gültig ist einzige IH/AC-Wahrheit", () => {
    (0, node_test_1.it)("ersetzt klassische IH/AC in allocations; Battery/Wallbox bleiben", () => {
        const classicIh = [
            classicEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, 1700, "2026-08-04T10:00:00.000Z", "2026-08-04T10:15:00.000Z"),
        ];
        const plan = basePlan(classicIh);
        const unified = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc006Input)());
        const pub = (0, dispatch_bridge_1.buildUnifiedIhAcDispatchPublish)(unified);
        strict_1.default.ok(pub.immersionEntries.length > 0);
        const merged = (0, authority_1.applyUnifiedIhAcAuthority)(plan, pub.immersionEntries, pub.climateEntries, {
            dailyPlanRevision: plan.revision,
            unifiedPlanId: unified.planId,
        });
        const ih = merged.allocations.filter((a) => a.contributionId.startsWith("immersion_heater."));
        const ac = merged.allocations.filter((a) => a.contributionId.startsWith("air_conditioning."));
        const bat = merged.allocations.filter((a) => a.contributionId.startsWith("battery."));
        const wb = merged.allocations.filter((a) => a.contributionId.startsWith("wallbox."));
        strict_1.default.equal(bat.length, 1);
        strict_1.default.equal(wb.length, 1);
        strict_1.default.equal(ih.every((e) => e.reasonDe.includes("classic")), false);
        strict_1.default.ok(ih.every((e) => e.reasonDe.includes(`daily_plan_rev=${plan.revision}`)));
        strict_1.default.ok(ih.every((e) => e.reasonDe.includes(`planId=${unified.planId}`)));
        const ihView = (0, addon_plan_publish_1.addonAllocationPublishView)(merged, "immersion_heater");
        strict_1.default.deepEqual(ihView.runnable.map((e) => `${e.contributionId}|${e.slot.startIso}|${e.allocatedPowerW}`), pub.immersionEntries.map((e) => `${e.contributionId}|${e.slot.startIso}|${e.allocatedPowerW}`));
        strict_1.default.equal(ac.length, pub.climateEntries.length);
    });
});
(0, node_test_1.describe)("AUTH-002 Unified idle [] — kein klassischer Fallback", () => {
    (0, node_test_1.it)("clearIhAcAuthority entfernt klassische IH/AC vollständig", () => {
        const classicIh = [
            classicEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, 1700, "2026-08-04T10:00:00.000Z", "2026-08-04T10:15:00.000Z"),
        ];
        const classicAc = [
            classicEntry(contribution_ids_1.CONTRIBUTION_IDS.AC_UNIT(1), 900, "2026-08-04T10:00:00.000Z", "2026-08-04T10:15:00.000Z"),
        ];
        const plan = basePlan(classicIh, classicAc);
        const cleared = (0, authority_1.clearIhAcAuthority)(plan);
        strict_1.default.equal(cleared.allocations.filter((a) => (0, authority_1.isIhAcContributionId)(a.contributionId)).length, 0);
        strict_1.default.equal((0, addon_plan_publish_1.addonAllocationPublishView)(cleared, "immersion_heater").status, "idle");
        strict_1.default.equal((0, addon_plan_publish_1.addonAllocationPublishView)(cleared, "air_conditioning").status, "idle");
        strict_1.default.equal((0, addon_plan_publish_1.addonAllocationPublishView)(cleared, "battery").status, "ready");
        strict_1.default.equal((0, addon_plan_publish_1.addonAllocationPublishView)(cleared, "wallbox").status, "ready");
        const noPv = (0, alloc_fixtures_1.alloc007Input)();
        noPv.thermal = { ...noPv.thermal, headroomEnergyKwh: 0 };
        noPv.pv.slots = noPv.pv.slots.map((s) => ({ ...s, forecastPowerW: 0, energyKwh: 0 }));
        const pub = (0, dispatch_bridge_1.buildUnifiedIhAcDispatchPublish)((0, allocate_1.allocateUnifiedDayPlan)(noPv));
        const merged = (0, authority_1.applyUnifiedIhAcAuthority)(plan, pub.immersionEntries, pub.climateEntries, {
            dailyPlanRevision: 17,
            unifiedPlanId: "unified-idle-test",
        });
        strict_1.default.equal(merged.allocations.filter((a) => a.contributionId.startsWith("immersion_heater.")).length, 0);
        strict_1.default.ok(merged.allocations.some((a) => a.contributionId.startsWith("battery.")));
    });
});
(0, node_test_1.describe)("AUTH-003 Unified Fehler → idle, nicht classic", () => {
    (0, node_test_1.it)("clearIhAcAuthority ist das definierte Failure-Verhalten", () => {
        const classicIh = [
            classicEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, 1700, "2026-08-04T10:00:00.000Z", "2026-08-04T10:15:00.000Z"),
        ];
        const plan = basePlan(classicIh);
        const failed = (0, authority_1.clearIhAcAuthority)(plan);
        strict_1.default.equal(failed.allocations.some((a) => a.reasonDe === "classic" && (0, authority_1.isIhAcContributionId)(a.contributionId)), false);
        strict_1.default.equal(failed.totals.immersionHeaterEnergyKwh, 0);
        strict_1.default.equal(failed.totals.airConditioningEnergyKwh, 0);
        strict_1.default.ok(failed.allocations.some((a) => a.contributionId === "battery.charge"));
    });
});
(0, node_test_1.describe)("AUTH-004 IH/AC-only helper keeps Battery/Wallbox", () => {
    (0, node_test_1.it)("applyUnifiedIhAcAuthority lässt Battery/Wallbox unverändert (null=keep)", () => {
        const plan = basePlan([
            classicEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, 1700, "2026-08-04T10:00:00.000Z", "2026-08-04T10:15:00.000Z"),
        ]);
        const beforeBat = plan.allocations.filter((a) => a.contributionId.startsWith("battery."));
        const beforeWb = plan.allocations.filter((a) => a.contributionId.startsWith("wallbox."));
        const pub = (0, dispatch_bridge_1.buildUnifiedIhAcDispatchPublish)((0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc001Input)()));
        const merged = (0, authority_1.applyUnifiedIhAcAuthority)(plan, pub.immersionEntries, pub.climateEntries, {
            dailyPlanRevision: plan.revision,
            unifiedPlanId: "x",
        });
        strict_1.default.deepEqual(merged.allocations.filter((a) => a.contributionId.startsWith("battery.")), beforeBat);
        strict_1.default.deepEqual(merged.allocations.filter((a) => a.contributionId.startsWith("wallbox.")), beforeWb);
    });
});
(0, node_test_1.describe)("allocations_json vs addon slices congruence", () => {
    (0, node_test_1.it)("IH/AC runnable views match merged plan allocations", () => {
        const plan = basePlan([]);
        const unified = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc006Input)());
        const pub = (0, dispatch_bridge_1.buildUnifiedIhAcDispatchPublish)(unified);
        const merged = (0, authority_1.applyUnifiedIhAcAuthority)(plan, pub.immersionEntries, pub.climateEntries, {
            dailyPlanRevision: 17,
            unifiedPlanId: unified.planId,
        });
        const ihView = (0, addon_plan_publish_1.addonAllocationPublishView)(merged, "immersion_heater");
        const fromAllocations = merged.allocations.filter((a) => a.contributionId.startsWith("immersion_heater.") && (a.allocatedPowerW ?? 0) >= 50);
        strict_1.default.equal(ihView.runnable.length, fromAllocations.length);
        strict_1.default.equal(ihView.runnable.length, pub.immersionEntries.length);
    });
});
