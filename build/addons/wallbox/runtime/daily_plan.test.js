"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const contribution_ids_1 = require("../../../operator/contribution_ids");
const contributor_1 = require("../../../operator/contributor");
const slots_1 = require("../../../operator/daily_plan/slots");
const time_1 = require("../../../operator/time");
const daily_plan_js_1 = require("./daily_plan.js");
const normalize_js_1 = require("../normalize.js");
const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = (0, slots_1.slotStartIsoFloored)(NOW, TZ);
const SLOT_END = (0, time_1.isoFromMs)(Date.parse(SLOT_START) + slots_1.DAILY_PLAN_SLOT_MS);
const DEADLINE = "2026-07-11T14:00:00.000Z";
function telemetry(over = {}) {
    return {
        connected: true,
        charging: false,
        vehicleSocPct: 40,
        planSocPct: 80,
        planActive: true,
        sessionEnergyKwh: 5,
        effectivePlanTime: DEADLINE,
        planTime: DEADLINE,
        activePhases: 1,
        configuredPhases: 3,
        minCurrentA: 6,
        maxCurrentA: 16,
        chargePowerW: null,
        evccConfigured: true,
        mappingsReady: true,
        ...over,
    };
}
function allocationEntry(allocatedPowerW, status = "allocated", over = {}) {
    return {
        contributionId: contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
        contributor: (0, contributor_1.addonContributorRef)("wallbox"),
        slot: { startIso: SLOT_START, endIso: SLOT_END },
        status,
        energySource: "grid",
        requestedPowerW: allocatedPowerW,
        allocatedPowerW,
        requestedEnergyKwh: null,
        allocatedEnergyKwh: allocatedPowerW !== null ? (allocatedPowerW * 0.25) / 1000 : null,
        gridPowerW: allocatedPowerW ?? 0,
        pvPowerW: 0,
        mandatory: false,
        priorityRank: 1,
        deadlineIso: DEADLINE,
        estimatedCostCt: allocatedPowerW !== null && allocatedPowerW > 0 ? 12 : null,
        reasonDe: "test",
        ...over,
    };
}
function evaluate(entries, tel = telemetry(), meta = {
    status: "ready",
    date: "2026-07-11",
    revision: 1,
    validUntil: null,
    timezone: TZ,
}) {
    return (0, daily_plan_js_1.evaluateWallboxDailyPlan)({
        now: NOW,
        timezone: TZ,
        meta,
        entries,
        telemetry: tel,
        governanceEnabled: true,
        addonEnabled: true,
        vehicleCapacityKwh: 60,
    });
}
function emptySnap() {
    return {
        observed_at: NOW.toISOString(),
        enabled: (0, normalize_js_1.missingField)(),
        connected: (0, normalize_js_1.missingField)(),
        charging: (0, normalize_js_1.missingField)(),
        charge_power_w: (0, normalize_js_1.missingField)(),
        session_energy_kwh: (0, normalize_js_1.missingField)(),
        vehicle_soc_pct: (0, normalize_js_1.missingField)(),
        plan_active: (0, normalize_js_1.missingField)(),
        plan_soc_pct: (0, normalize_js_1.missingField)(),
        plan_time: (0, normalize_js_1.missingField)(),
        effective_plan_time: (0, normalize_js_1.missingField)(),
        active_phases: (0, normalize_js_1.missingField)(),
        configured_phases: (0, normalize_js_1.missingField)(),
        min_current_a: (0, normalize_js_1.missingField)(),
        max_current_a: (0, normalize_js_1.missingField)(),
        battery_mode: (0, normalize_js_1.missingField)(),
        battery_discharge_control: (0, normalize_js_1.missingField)(),
    };
}
(0, node_test_1.describe)("wallbox connected gate", () => {
    (0, node_test_1.it)("disconnected with soc 0 is safe", () => {
        const d = evaluate([allocationEntry(3600)], telemetry({ connected: false, vehicleSocPct: 0 }));
        strict_1.default.equal(d.decisionSource, "vehicle_disconnected");
        strict_1.default.equal(d.chargingAllowedByPlan, false);
        strict_1.default.equal(d.planValid, false);
        strict_1.default.equal(d.planExecutionStatus, "vehicle_disconnected");
        strict_1.default.match(d.reasonDe, /nicht verbunden/);
    });
    (0, node_test_1.it)("disconnected ignores positive allocation", () => {
        const d = evaluate([allocationEntry(7200)], telemetry({ connected: false }));
        strict_1.default.equal(d.chargingAllowedByPlan, false);
        strict_1.default.equal(d.allocatedPowerW, null);
    });
    (0, node_test_1.it)("disconnected with deadline does not warn", () => {
        const d = evaluate([allocationEntry(3600)], telemetry({ connected: false, effectivePlanTime: DEADLINE }));
        strict_1.default.equal(d.deadlineReachable, null);
        strict_1.default.equal(d.decisionSource, "vehicle_disconnected");
    });
    (0, node_test_1.it)("connected allows plan evaluation", () => {
        const d = evaluate([allocationEntry(3600)]);
        strict_1.default.equal(d.connected, true);
        strict_1.default.equal(d.useDailyPlan, true);
        strict_1.default.equal(d.chargingAllowedByPlan, true);
    });
    (0, node_test_1.it)("unknown connected blocks allowance", () => {
        const d = evaluate([allocationEntry(3600)], telemetry({ connected: null }));
        strict_1.default.equal(d.decisionSource, "missing_telemetry");
        strict_1.default.equal(d.chargingAllowedByPlan, false);
    });
});
(0, node_test_1.describe)("wallbox daily plan reader", () => {
    (0, node_test_1.beforeEach)(() => (0, daily_plan_js_1.resetWallboxDailyPlanCache)());
    (0, node_test_1.it)("parses valid allocation JSON", () => {
        const parsed = (0, daily_plan_js_1.parseDailyAllocationEntries)(JSON.stringify([allocationEntry(3600)]));
        strict_1.default.ok(parsed);
        strict_1.default.equal(parsed.length, 1);
    });
    (0, node_test_1.it)("rejects invalid JSON", () => {
        strict_1.default.equal((0, daily_plan_js_1.parseDailyAllocationEntries)("{bad"), null);
    });
    (0, node_test_1.it)("rejects wrong contribution id via evaluation", () => {
        const wrong = allocationEntry(3600);
        wrong.contributionId = "battery.storage";
        const d = evaluate([wrong]);
        strict_1.default.equal(d.dailyPlanStatus, "daily_plan_zero_allocation");
        strict_1.default.equal(d.chargingAllowedByPlan, false);
    });
    (0, node_test_1.it)("detects duplicate allocation in slot", () => {
        const d = evaluate([allocationEntry(3600), allocationEntry(1800)]);
        strict_1.default.equal(d.decisionSource, "invalid_plan");
        strict_1.default.match(d.reasonDe, /Doppelte/);
    });
    (0, node_test_1.it)("rejects wrong date", () => {
        const d = evaluate([allocationEntry(3600)], telemetry(), {
            status: "ready",
            date: "2026-07-10",
            revision: 1,
            validUntil: null,
            timezone: TZ,
        });
        strict_1.default.equal(d.dailyPlanStatus, "daily_plan_wrong_date");
        strict_1.default.equal(d.useDailyPlan, false);
    });
    (0, node_test_1.it)("rejects expired plan", () => {
        const d = evaluate([allocationEntry(3600)], telemetry(), {
            status: "ready",
            date: "2026-07-11",
            revision: 1,
            validUntil: "2026-07-11T09:00:00.000Z",
            timezone: TZ,
        });
        strict_1.default.equal(d.dailyPlanStatus, "daily_plan_expired");
    });
    (0, node_test_1.it)("accepts degraded plan status", () => {
        const d = evaluate([allocationEntry(3600)], telemetry(), {
            status: "degraded",
            date: "2026-07-11",
            revision: 1,
            validUntil: null,
            timezone: TZ,
        });
        strict_1.default.equal(d.planValid, true);
    });
    (0, node_test_1.it)("valid zero allocation without fallback order", () => {
        const d = evaluate([]);
        strict_1.default.equal(d.useDailyPlan, true);
        strict_1.default.equal(d.decisionSource, "daily_plan_zero");
        strict_1.default.equal(d.chargingAllowedByPlan, false);
    });
    (0, node_test_1.it)("unallocated status is not active", () => {
        const d = evaluate([allocationEntry(3600, "unallocated")]);
        strict_1.default.equal(d.chargingAllowedByPlan, false);
        strict_1.default.equal(d.decisionSource, "daily_plan_zero");
    });
    (0, node_test_1.it)("rejects null and negative power", () => {
        strict_1.default.equal(evaluate([allocationEntry(null)]).chargingAllowedByPlan, false);
        strict_1.default.equal(evaluate([allocationEntry(-100)]).chargingAllowedByPlan, false);
    });
    (0, node_test_1.it)("uses addon allocation plan via resolveWallboxDailyPlanDecision", async () => {
        const host = {
            config: { timezone: TZ },
            async getStateAsync(id) {
                const map = {
                    "planner.intent.daily_plan.status": "ready",
                    "planner.intent.daily_plan.date": "2026-07-11",
                    "planner.intent.daily_plan.revision": 5,
                    "planner.intent.daily_plan.valid_until": "",
                    "planner.intent.allocation.wallbox.plan_json": JSON.stringify([allocationEntry(3600)]),
                };
                if (!(id in map))
                    return null;
                return { val: map[id], ack: true };
            },
        };
        const snap = emptySnap();
        snap.connected = { status: "valid", value: true, raw: true };
        snap.charging = { status: "valid", value: false, raw: false };
        snap.active_phases = { status: "valid", value: 1, raw: 1 };
        snap.min_current_a = { status: "valid", value: 6, raw: 6 };
        snap.max_current_a = { status: "valid", value: 16, raw: 16 };
        snap.effective_plan_time = { status: "valid", value: DEADLINE, raw: DEADLINE };
        const cfg = {
            enabledStateId: "evcc.0.enabled",
            connectedStateId: "evcc.0.connected",
            chargingStateId: "",
            chargePowerWStateId: "",
            sessionEnergyKwhStateId: "",
            vehicleSocStateId: "",
            planActiveStateId: "",
            planSocStateId: "",
            planTimeStateId: "",
            effectivePlanTimeStateId: "",
            activePhasesStateId: "",
            configuredPhasesStateId: "",
            minCurrentAStateId: "",
            maxCurrentAStateId: "",
            batteryModeStateId: "",
            batteryDischargeControlStateId: "",
        };
        const d = await (0, daily_plan_js_1.resolveWallboxDailyPlanDecision)(host, snap, cfg, NOW, {
            governanceEnabled: true,
            addonEnabled: true,
            vehicleCapacityKwh: 60,
        });
        strict_1.default.equal(d.chargingAllowedByPlan, true);
        strict_1.default.equal(d.allocatedPowerW, 3600);
    });
});
(0, node_test_1.describe)("wallbox power limits", () => {
    (0, node_test_1.it)("computes min charge power from phases and current", () => {
        strict_1.default.equal((0, daily_plan_js_1.wallboxMinChargePowerW)(1, 6), 1380);
        strict_1.default.equal((0, daily_plan_js_1.wallboxMinChargePowerW)(3, 6), 4140);
    });
    (0, node_test_1.it)("allows allocation at exact minimum", () => {
        const minW = (0, daily_plan_js_1.wallboxMinChargePowerW)(1, 6);
        const d = evaluate([allocationEntry(minW)], telemetry({ activePhases: 1, maxCurrentA: 16 }));
        strict_1.default.equal(d.chargingAllowedByPlan, true);
    });
    (0, node_test_1.it)("blocks allocation below minimum", () => {
        const d = evaluate([allocationEntry(1000)], telemetry({ activePhases: 1, minCurrentA: 6, maxCurrentA: 16 }));
        strict_1.default.equal(d.dailyPlanStatus, "allocation_below_min_power");
        strict_1.default.equal(d.chargingAllowedByPlan, false);
    });
    (0, node_test_1.it)("caps allocation above max power", () => {
        const d = evaluate([allocationEntry(11000)], telemetry({ activePhases: 1, maxCurrentA: 16 }));
        strict_1.default.equal(d.allocatedPowerW, 3680);
        strict_1.default.equal(d.chargingAllowedByPlan, true);
    });
    (0, node_test_1.it)("single phase limit — no 3-phase assumption", () => {
        const limits = (0, daily_plan_js_1.resolveWallboxPowerLimits)(telemetry({ activePhases: 1, configuredPhases: 3, maxCurrentA: 16 }));
        strict_1.default.equal(limits.maxChargePowerW, 3680);
    });
    (0, node_test_1.it)("missing phase data marks degraded", () => {
        const limits = (0, daily_plan_js_1.resolveWallboxPowerLimits)(telemetry({ activePhases: null, configuredPhases: null, maxCurrentA: null }));
        strict_1.default.equal(limits.degraded, true);
        const d = evaluate([allocationEntry(3600)], telemetry({ activePhases: null, maxCurrentA: null }));
        strict_1.default.equal(d.dailyPlanStatus, "power_limits_unknown");
        strict_1.default.equal(d.chargingAllowedByPlan, false);
    });
});
(0, node_test_1.describe)("wallbox energy and deadline", () => {
    (0, node_test_1.it)("remaining energy from soc and capacity", () => {
        const rem = (0, daily_plan_js_1.computeRemainingEnergyKwh)(telemetry({ vehicleSocPct: 40, planSocPct: 80 }), 60);
        strict_1.default.equal(rem, 24);
    });
    (0, node_test_1.it)("unknown capacity yields null remaining", () => {
        strict_1.default.equal((0, daily_plan_js_1.computeRemainingEnergyKwh)(telemetry({ vehicleSocPct: 40, planSocPct: 80 }), null), null);
    });
    (0, node_test_1.it)("summarizes planned energy until deadline", () => {
        const futureSlot = (0, time_1.isoFromMs)(Date.parse(SLOT_START) + slots_1.DAILY_PLAN_SLOT_MS);
        const futureEnd = (0, time_1.isoFromMs)(Date.parse(futureSlot) + slots_1.DAILY_PLAN_SLOT_MS);
        const entries = [
            allocationEntry(3600, "allocated", {
                slot: { startIso: futureSlot, endIso: futureEnd },
                energySource: "pv_surplus",
                pvPowerW: 3600,
                gridPowerW: 0,
            }),
        ];
        const summary = (0, daily_plan_js_1.summarizeWallboxPlanUntilDeadline)(entries, DEADLINE, NOW.getTime());
        strict_1.default.ok(summary.plannedEnergyUntilDeadlineKwh > 0);
        strict_1.default.ok(summary.plannedPvEnergyUntilDeadlineKwh > 0);
        strict_1.default.equal(summary.activePlannedSlots, 1);
    });
    (0, node_test_1.it)("deadline reachable when planned energy sufficient", () => {
        const d = evaluate([allocationEntry(3600)], telemetry({ vehicleSocPct: 70, planSocPct: 80 }));
        strict_1.default.equal(typeof d.deadlineReachable, "boolean");
    });
    (0, node_test_1.it)("missing price yields null cost", () => {
        const d = evaluate([allocationEntry(3600, "allocated", { estimatedCostCt: null })]);
        strict_1.default.equal(d.estimatedCostCt, null);
    });
});
(0, node_test_1.describe)("wallbox governance and mapping", () => {
    (0, node_test_1.it)("governance disabled blocks plan allowance", () => {
        const d = (0, daily_plan_js_1.evaluateWallboxDailyPlan)({
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [allocationEntry(3600)],
            telemetry: telemetry(),
            governanceEnabled: false,
            addonEnabled: true,
        });
        strict_1.default.equal(d.decisionSource, "governance_disabled");
        strict_1.default.equal(d.chargingAllowedByPlan, false);
    });
    (0, node_test_1.it)("addon disabled", () => {
        const d = (0, daily_plan_js_1.evaluateWallboxDailyPlan)({
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [allocationEntry(3600)],
            telemetry: telemetry(),
            governanceEnabled: true,
            addonEnabled: false,
        });
        strict_1.default.equal(d.decisionSource, "addon_disabled");
    });
    (0, node_test_1.it)("mapping incomplete", () => {
        const d = evaluate([allocationEntry(3600)], telemetry({ mappingsReady: false }));
        strict_1.default.equal(d.decisionSource, "mapping_incomplete");
    });
});
(0, node_test_1.describe)("wallbox plan execution status", () => {
    (0, node_test_1.it)("in plan when charging with allocation", () => {
        const d = evaluate([allocationEntry(3600)], telemetry({ charging: true }));
        strict_1.default.equal(d.planExecutionStatus, "in_plan");
    });
    (0, node_test_1.it)("charging without plan", () => {
        const d = evaluate([], telemetry({ charging: true }));
        strict_1.default.equal(d.planExecutionStatus, "charging_without_plan");
    });
    (0, node_test_1.it)("planned but not charging", () => {
        const d = evaluate([allocationEntry(3600)], telemetry({ charging: false }));
        strict_1.default.equal(d.planExecutionStatus, "planned_but_not_charging");
    });
    (0, node_test_1.it)("not planned not charging", () => {
        const d = evaluate([], telemetry({ charging: false }));
        strict_1.default.equal(d.planExecutionStatus, "not_planned_not_charging");
    });
});
(0, node_test_1.describe)("wallbox read-only guarantee", () => {
    (0, node_test_1.it)("decision always reports read-only flags", () => {
        const d = evaluate([allocationEntry(3600)]);
        strict_1.default.equal(d.runtimeControlAvailable, false);
        strict_1.default.equal(d.writeAllowed, false);
    });
    (0, node_test_1.it)("external plan only when no valid daily plan", () => {
        const d = evaluate([], telemetry({ planActive: true }), {
            status: "not_initialized",
            date: "2026-07-11",
            revision: 0,
            validUntil: null,
            timezone: TZ,
        });
        strict_1.default.equal(d.decisionSource, "external_plan_only");
        strict_1.default.equal(d.externalPlanActive, true);
    });
});
(0, node_test_1.describe)("wallbox plan cache lifecycle", () => {
    (0, node_test_1.beforeEach)(() => (0, daily_plan_js_1.resetWallboxDailyPlanCache)());
    (0, node_test_1.it)("parse error invalidates cache", async () => {
        const host = {
            config: { timezone: TZ },
            async getStateAsync(id) {
                if (id === "planner.intent.allocation.wallbox.plan_json") {
                    return { val: "{invalid", ack: true };
                }
                const base = {
                    "planner.intent.daily_plan.status": "ready",
                    "planner.intent.daily_plan.date": "2026-07-11",
                    "planner.intent.daily_plan.revision": 1,
                    "planner.intent.daily_plan.valid_until": "",
                };
                return { val: base[id] ?? "", ack: true };
            },
        };
        const snap = emptySnap();
        snap.connected = { status: "valid", value: true, raw: true };
        const cfg = { enabledStateId: "x", connectedStateId: "y" };
        const d = await (0, daily_plan_js_1.resolveWallboxDailyPlanDecision)(host, snap, cfg, NOW, {
            governanceEnabled: true,
            addonEnabled: true,
        });
        strict_1.default.equal(d.decisionSource, "invalid_plan");
    });
    (0, node_test_1.it)("resetWallboxDailyPlanCache clears state", () => {
        (0, daily_plan_js_1.resetWallboxDailyPlanCache)();
        strict_1.default.doesNotThrow(() => (0, daily_plan_js_1.resetWallboxDailyPlanCache)());
    });
});
