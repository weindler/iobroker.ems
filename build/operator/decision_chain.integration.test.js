"use strict";
/**
 * Integration: Unified/Daily-Plan → Runtime-Intent → Safety → Execution-Desired → Hold → GB → Constraints.
 * Verhindert widersprüchliche Geräteentscheidungen zwischen Planner, Runtime, Execution und Hold/VIS-Inputs.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const contribution_ids_1 = require("./contribution_ids");
const contributor_1 = require("./contributor");
const slots_1 = require("./daily_plan/slots");
const time_1 = require("./time");
const daily_plan_1 = require("../addons/wallbox/runtime/daily_plan");
const intent_1 = require("../addons/wallbox/runtime/intent");
const desired_mode_1 = require("../addons/wallbox/ev_foundation/execution/desired_mode");
const charge_hold_1 = require("../addons/wallbox/charge_hold");
const battery_1 = require("./planning/battery");
const grid_balance_contract_1 = require("../addons/battery/grid_balance_contract");
const hold_freshness_1 = require("../addons/battery/hold_freshness");
const grid_balance_power_1 = require("../addons/battery/grid_balance_power");
const compute_desired_1 = require("../addons/air_conditioning/runtime/compute_desired");
const daily_plan_2 = require("../addons/immersion_heater/runtime/daily_plan");
const device_config_1 = require("../addons/immersion_heater/device_config");
const daily_plan_3 = require("../addons/battery/runtime/daily_plan");
const model_1 = require("../addons/wallbox/ev_foundation/model");
const TZ = "UTC";
const NOW = new Date("2026-08-17T10:07:00.000Z");
const SLOT_START = (0, slots_1.slotStartIsoFloored)(NOW, TZ);
const SLOT_END = (0, time_1.isoFromMs)(Date.parse(SLOT_START) + slots_1.DAILY_PLAN_SLOT_MS);
function wbEntry(allocatedPowerW, energySource = "grid") {
    return {
        contributionId: contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
        contributor: (0, contributor_1.addonContributorRef)("wallbox"),
        slot: { startIso: SLOT_START, endIso: SLOT_END },
        status: "allocated",
        energySource,
        requestedPowerW: allocatedPowerW,
        allocatedPowerW,
        requestedEnergyKwh: allocatedPowerW > 0 ? (allocatedPowerW * 0.25) / 1000 : 0,
        allocatedEnergyKwh: allocatedPowerW > 0 ? (allocatedPowerW * 0.25) / 1000 : 0,
        gridPowerW: energySource === "grid" ? allocatedPowerW : 0,
        pvPowerW: energySource === "pv_surplus" ? allocatedPowerW : 0,
        mandatory: false,
        priorityRank: 1,
        deadlineIso: null,
        estimatedCostCt: null,
        reasonDe: "test",
    };
}
function telemetry(over = {}) {
    return {
        connected: true,
        charging: false,
        vehicleSocPct: 40,
        planSocPct: 80,
        planActive: false,
        sessionEnergyKwh: 0,
        effectivePlanTime: null,
        planTime: null,
        activePhases: 3,
        configuredPhases: 3,
        minCurrentA: 6,
        maxCurrentA: 16,
        chargePowerW: 0,
        evccConfigured: true,
        mappingsReady: true,
        ...over,
    };
}
function runEvChain(input) {
    const decision = (0, daily_plan_1.evaluateWallboxDailyPlan)({
        now: NOW,
        timezone: TZ,
        meta: { status: "ready", date: "2026-08-17", revision: 4, validUntil: null, timezone: TZ },
        entries: [wbEntry(input.allocatedPowerW, input.energySource ?? "grid")],
        telemetry: telemetry({
            connected: input.connected,
            charging: input.charging,
            chargePowerW: input.chargePowerW,
        }),
        governanceEnabled: true,
        addonEnabled: true,
        vehicleCapacityKwh: 60,
    });
    const intent = (0, intent_1.buildWallboxDispatchIntent)({
        decision,
        governanceEnabled: true,
        addonEnabled: true,
        phases: 3,
        now: NOW,
    });
    const desired = (0, desired_mode_1.projectDesiredEvccMode)({
        intentAction: intent.action,
        energySource: intent.source !== "none" ? intent.source : decision.energySource,
        chargingAllowed: decision.chargingAllowedByPlan,
        allocatedPowerW: decision.allocatedPowerW,
        dailyPlanStatus: decision.dailyPlanStatus,
        decisionSource: decision.decisionSource,
        planValid: decision.planValid,
        useDailyPlan: decision.useDailyPlan,
        vehicleConnected: decision.connected,
    });
    const hold = (0, charge_hold_1.resolveWallboxBatteryHold)({
        vehicleConnected: input.connected,
        charging: input.charging,
        chargePowerW: input.chargePowerW,
        batteryBoost: input.batteryBoost ?? false,
        loadpointMode: input.loadpointMode,
        externalVehicleChargeRaw: null,
        tibberGridRewardsActive: false,
    });
    const constraints = (0, battery_1.buildPlannerConstraints)({
        evccBatteryMode: "normal",
        evccBatteryDischargeControl: true,
        userIntentBatteryHold: false,
        wallboxChargeHold: hold.hold,
        wallboxChargeHoldReasonDe: hold.reasonDe,
    });
    const evConflict = (0, grid_balance_contract_1.classifyGridBalanceEvConflict)({
        loadpointMode: input.loadpointMode,
        charging: input.charging,
        chargePowerW: input.chargePowerW,
        wallboxHold: hold.hold,
        batteryBoost: input.batteryBoost === true,
        externalAuthority: false,
        tibberRewardsActive: false,
        wallboxEnergySource: decision.energySource,
        wallboxAllocatedGridW: decision.gridPowerW,
        vehicleConnected: input.connected,
    });
    const gbHold = (0, hold_freshness_1.resolveGridBalanceHoldSignals)({
        nowMs: NOW.getTime(),
        constraintHoldState: { val: constraints.battery_hold_active, ts: NOW.getTime() },
        deviceIntentHold: false,
        batteryHoldForEvCharge: hold.hold,
        evccBatteryMode: "normal",
    });
    const gbSafety = (0, grid_balance_contract_1.evaluateGridBalanceSafety)(gbSafetyInput({
        holdActive: gbHold.holdActive,
        holdPlanned: gbHold.holdPlanned,
        evccBatteryModeHold: gbHold.evccBatteryModeHold,
        evConflictKind: evConflict.kind,
    }));
    return { decision, intent, desired, hold, constraints, evConflict, gbHold, gbSafety };
}
function gbSafetyInput(over = {}) {
    return {
        adminEnabled: true,
        emsMirrorEnabled: true,
        globalLive: true,
        addonLive: true,
        addonEnabled: true,
        governanceEnabled: true,
        faultActive: false,
        lockoutActive: false,
        restoreInProgress: false,
        sourceStale: false,
        sourceOffline: false,
        holdPlanned: false,
        holdActive: false,
        evccBatteryModeHold: false,
        plannedBatteryAction: false,
        ownershipActive: false,
        dailyPlanAuthoritative: false,
        mode1Active: false,
        priceNowCt: 36.7,
        priceMinCt: 30,
        evConflictKind: "",
        externalEvAuthority: false,
        ...over,
    };
}
(0, node_test_1.describe)("decision chain — EV leftover now must not override planner", () => {
    (0, node_test_1.it)("vehicleConnected=false + EVCC now + leftover allocation → no EV action, no hold, no GB EV conflict", () => {
        const r = runEvChain({
            connected: false,
            charging: false,
            chargePowerW: 0,
            loadpointMode: "now",
            batteryBoost: true,
            allocatedPowerW: 11000,
        });
        strict_1.default.equal(r.decision.decisionSource, "vehicle_disconnected");
        strict_1.default.equal(r.decision.chargingAllowedByPlan, false);
        strict_1.default.equal(r.intent.action, "none");
        strict_1.default.equal(r.desired.desired, "noop");
        strict_1.default.equal(r.desired.reason, "vehicle_disconnected");
        strict_1.default.equal(r.hold.hold, false);
        strict_1.default.equal(r.constraints.battery_hold_active, false);
        strict_1.default.equal(r.evConflict.conflict, false);
        strict_1.default.equal(r.gbHold.holdDetected, false);
        strict_1.default.notEqual(r.gbSafety.blockReason, "battery_hold");
        strict_1.default.notEqual(r.gbSafety.blockReason, "ev_now_grid_charge");
        strict_1.default.equal((0, model_1.derivePreparedEvModuleState)("now", false), "idle");
    });
    (0, node_test_1.it)("connected leftover now without charging → planner none, no hold from mode=now", () => {
        const r = runEvChain({
            connected: true,
            charging: false,
            chargePowerW: 0,
            loadpointMode: "now",
            allocatedPowerW: 0,
            energySource: "pv_surplus",
        });
        strict_1.default.equal(r.intent.action === "charge", false);
        strict_1.default.notEqual(r.desired.desired, "now");
        strict_1.default.equal(r.hold.hold, false);
        strict_1.default.equal(r.constraints.battery_hold_active, false);
        strict_1.default.equal(r.evConflict.conflict, false);
        strict_1.default.equal(r.gbHold.holdDetected, false);
    });
    (0, node_test_1.it)("connected + charging + now is observed hold (safety), EMS desired still follows the plan", () => {
        const r = runEvChain({
            connected: true,
            charging: true,
            chargePowerW: 11000,
            loadpointMode: "now",
            allocatedPowerW: 0,
        });
        strict_1.default.equal(r.decision.chargingAllowedByPlan, false);
        strict_1.default.notEqual(r.desired.desired, "now");
        strict_1.default.equal(r.hold.hold, true);
        strict_1.default.equal(r.constraints.battery_hold_active, true);
        strict_1.default.equal(r.evConflict.kind, "ev_now");
        strict_1.default.equal(r.gbHold.holdDetected, true);
        strict_1.default.equal(r.gbSafety.blockReason, "battery_hold");
    });
    (0, node_test_1.it)("connected + EMS grid allocation → charge desired now, hold from actual charging", () => {
        const r = runEvChain({
            connected: true,
            charging: true,
            chargePowerW: 7200,
            loadpointMode: "pv",
            allocatedPowerW: 7200,
            energySource: "grid",
        });
        strict_1.default.equal(r.decision.chargingAllowedByPlan, true);
        strict_1.default.equal(r.intent.action, "charge");
        strict_1.default.equal(r.desired.desired, "now");
        strict_1.default.equal(r.desired.reason, "planned_charge");
    });
});
(0, node_test_1.describe)("decision chain — Grid Balance EV subtract", () => {
    (0, node_test_1.it)("disconnected leftover charging flag does not treat EV as house load", () => {
        const ev = (0, grid_balance_power_1.adjustConsumptionForEv)({
            consumptionW: 4000,
            charging: true,
            chargePowerW: 3500,
            chargePowerAgeMs: 500,
            vehicleConnected: false,
        });
        strict_1.default.equal(ev.evActive, false);
        strict_1.default.equal(ev.adjustedConsumptionW, 4000);
        strict_1.default.equal(ev.blockReason, "");
    });
});
(0, node_test_1.describe)("decision chain — Klima / Heizstab / Batterie follow Daily Plan", () => {
    (0, node_test_1.it)("Klima: gültiger 0-W-Plan ist Planner-OFF, nicht climate_fallback", () => {
        const fsm = {
            state: "running",
            demandStart: false,
            demandStop: false,
            modePurpose: "cooling",
            reasonDe: "läuft",
        };
        const dailyPlan = {
            unitIndex: 1,
            contributionId: contribution_ids_1.CONTRIBUTION_IDS.AC_UNIT(1),
            dailyPlanStatus: "daily_plan_zero_allocation",
            dailyPlanRevision: 2,
            slotStartIso: SLOT_START,
            slotEndIso: SLOT_END,
            allocatedPowerW: 0,
            expectedPowerW: 850,
            powerModelSource: "config",
            allocationStatus: "allocated",
            allocationReasonDe: "0 W im Slot",
            useDailyPlan: true,
            powerModelValid: true,
            allocationAllowsStart: false,
        };
        const d = (0, compute_desired_1.computeAcCoolingDesired)({
            unitEnabled: true,
            governanceEnabled: true,
            addonEnabled: true,
            cleaningActive: false,
            fsm,
            dailyPlan,
            feedbackOn: true,
            startRetryReady: true,
        });
        strict_1.default.equal(d.plannerOff, true);
        strict_1.default.equal(d.desired, "off");
        strict_1.default.equal(d.decisionSource, "daily_plan");
        strict_1.default.notEqual(d.decisionSource, "climate_fallback");
    });
    (0, node_test_1.it)("Heizstab: gültiger 0-W-Plan bleibt Daily Plan, kein Thermal-Fallback", () => {
        const cfg = (0, device_config_1.immersionDeviceConfigFromAdapter)({
            ih_stage_count: 1,
            ih_stage_1_nominal_power_w: 1700,
            ih_stage_1_set_state: "s1",
            ih_stage_1_enabled: true,
        });
        const r = (0, daily_plan_2.resolveImmersionDailyPlanFromData)({
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-08-17", revision: 2, validUntil: null, timezone: TZ },
            entries: [],
            config: cfg,
        });
        strict_1.default.equal(r.useDailyPlan, true);
        strict_1.default.equal(r.dailyPlanStatus, "daily_plan_zero_allocation");
        strict_1.default.equal(r.commandedStage, 0);
        strict_1.default.equal(r.decisionSource, "daily_plan");
        strict_1.default.notEqual(r.decisionSource, "thermal_fallback");
    });
    (0, node_test_1.it)("Batterie: Daily-Plan 0 W → self_consumption, nicht leftover EV-Hold-Intent", () => {
        const ctx = {
            useDailyPlan: true,
            dailyPlanAuthoritative: true,
            dailyPlanStatus: "daily_plan_zero_allocation",
            decisionSource: "daily_plan_zero",
            dailyPlanRevision: 2,
            slotStartIso: SLOT_START,
            slotEndIso: SLOT_END,
            allocationStatus: "none",
            allocatedChargePowerW: 0,
            effectiveChargePowerW: 0,
            requestedChargePowerW: 0,
            allocatedEnergyKwh: 0,
            pvPowerW: 0,
            gridPowerW: 0,
            energySource: "none",
            estimatedCostCt: null,
            chargePowerCapped: false,
            targetSocPct: 90,
            topOffActive: false,
            chargingAllowed: false,
            allocationReasonDe: "kein Batterieladen",
            legacyFallbackActive: false,
            legacyFallbackSource: "",
            legacyFallbackReasonDe: "",
            dailyPlanBlocksGridBalance: false,
            runtimeControlAvailable: true,
            dischargeIgnored: false,
        };
        const intent = (0, daily_plan_3.deviceIntentFromDailyPlan)(ctx, NOW.getTime());
        strict_1.default.equal(intent.source, "daily_plan");
        strict_1.default.equal(intent.action, "self_consumption");
        strict_1.default.notEqual(intent.action, "hold");
        strict_1.default.equal(intent.maxChargeW, 0);
        const gb = (0, grid_balance_contract_1.evaluateGridBalanceSafety)(gbSafetyInput({
            dailyPlanAuthoritative: true,
            plannedBatteryAction: false,
            ownershipActive: false,
            mode1Active: false,
            priceNowCt: 36.7,
            priceMinCt: 30,
        }));
        strict_1.default.equal(gb.blockReason, "");
        strict_1.default.notEqual(gb.blockReason, "planned_battery_action");
        strict_1.default.equal(gb.holdDetected, false);
        strict_1.default.equal(gb.evConflict, false);
        strict_1.default.equal(gb.priceAllowed, true);
    });
    (0, node_test_1.it)("Batterie: echte EMS-Ladung / Ownership blockiert Grid Balance weiter als planned_battery_action", () => {
        const ctx = {
            useDailyPlan: true,
            dailyPlanAuthoritative: true,
            dailyPlanStatus: "daily_plan_valid",
            decisionSource: "daily_plan",
            dailyPlanRevision: 2,
            slotStartIso: SLOT_START,
            slotEndIso: SLOT_END,
            allocationStatus: "allocated",
            allocatedChargePowerW: 2500,
            effectiveChargePowerW: 2500,
            requestedChargePowerW: 2500,
            allocatedEnergyKwh: 0.625,
            pvPowerW: 0,
            gridPowerW: 2500,
            energySource: "grid",
            estimatedCostCt: null,
            chargePowerCapped: false,
            targetSocPct: 90,
            topOffActive: false,
            chargingAllowed: true,
            allocationReasonDe: "Daily Plan sieht 2500 W Batterieladung vor (grid).",
            legacyFallbackActive: false,
            legacyFallbackSource: "",
            legacyFallbackReasonDe: "",
            dailyPlanBlocksGridBalance: true,
            runtimeControlAvailable: true,
            dischargeIgnored: false,
        };
        const intent = (0, daily_plan_3.deviceIntentFromDailyPlan)(ctx, NOW.getTime());
        strict_1.default.equal(intent.action, "grid_charge");
        strict_1.default.equal(intent.maxChargeW, 2500);
        const gb = (0, grid_balance_contract_1.evaluateGridBalanceSafety)(gbSafetyInput({
            dailyPlanAuthoritative: true,
            plannedBatteryAction: true,
            ownershipActive: true,
            mode1Active: true,
        }));
        strict_1.default.equal(gb.blockReason, "planned_battery_action");
        strict_1.default.equal(gb.authority, "planned_battery");
    });
});
