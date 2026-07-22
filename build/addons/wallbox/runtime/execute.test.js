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
const intent_js_1 = require("./intent.js");
const dispatch_js_1 = require("./dispatch.js");
const control_mapping_js_1 = require("./control_mapping.js");
const write_plan_js_1 = require("./write_plan.js");
const execute_js_1 = require("./execute.js");
const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = (0, slots_1.slotStartIsoFloored)(NOW, "UTC");
const SLOT_END = (0, time_1.isoFromMs)(Date.parse(SLOT_START) + slots_1.DAILY_PLAN_SLOT_MS);
function testMapping() {
    return (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
        config: {
            wb_control_model: "legacy_direct",
            wb_set_enabled_target: "go-e.0.allow_charging",
            wb_set_enabled_enabled: true,
            wb_set_current_a_target: "go-e.0.amperePV",
            wb_set_current_a_enabled: true,
        },
        telemetryCfg: {
            enabledStateId: "evcc.0.enabled",
            maxCurrentAStateId: "",
            modeReadbackStateId: "",
        },
        objectMetas: {
            "go-e.0.allow_charging": {
                stateId: "go-e.0.allow_charging",
                objectPresent: true,
                writable: true,
                commonType: "boolean",
                allowedStateKeys: null,
            },
            "go-e.0.amperePV": {
                stateId: "go-e.0.amperePV",
                objectPresent: true,
                writable: true,
                commonType: "number",
                allowedStateKeys: null,
            },
        },
    });
}
const EVCC_MODE = "evcc.0.loadpoint.1.mode";
const EVCC_MAX_CURRENT = "evcc.0.loadpoint.1.maxCurrent";
const MODE_STATES = ["pv", "off", "now"];
function meta(id, commonType, writable = true, allowedStateKeys = null) {
    return { stateId: id, objectPresent: true, writable, commonType, allowedStateKeys };
}
function testEvccMapping() {
    return (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
        config: {
            wb_control_model: "evcc",
            wb_evcc_set_mode_target: EVCC_MODE,
            wb_evcc_set_max_current_a_target: EVCC_MAX_CURRENT,
            wb_evcc_mode_charge_value: "pv",
            wb_evcc_mode_hold_value: "off",
        },
        telemetryCfg: {
            enabledStateId: "evcc.0.loadpoint.1.enabled",
            maxCurrentAStateId: "evcc.0.telemetry.maxCurrent",
            modeReadbackStateId: EVCC_MODE,
        },
        objectMetas: {
            [EVCC_MODE]: meta(EVCC_MODE, "string", true, MODE_STATES),
            [EVCC_MAX_CURRENT]: meta(EVCC_MAX_CURRENT, "number"),
        },
    });
}
function chargeWritePlan(c = chargeCandidate(), chargingEnabled = false) {
    return (0, write_plan_js_1.buildWallboxWritePlan)({
        candidate: c,
        mapping: testMapping(),
        chargingEnabled,
        chargeModeActive: null,
        now: NOW,
    });
}
function evccChargeWritePlan(c = chargeCandidate(), chargeModeActive = false) {
    return (0, write_plan_js_1.buildWallboxWritePlan)({
        candidate: c,
        mapping: testEvccMapping(),
        chargingEnabled: null,
        chargeModeActive,
        now: NOW,
    });
}
function chargeCandidate(over = {}) {
    return {
        action: "charge",
        targetPowerW: 3600,
        targetCurrentA: 16,
        energySource: "grid",
        connected: true,
        technicallyReady: true,
        dispatchRevision: 1,
        planRevision: 1,
        createdAt: NOW.toISOString(),
        blocked: false,
        blockReason: null,
        ...over,
    };
}
function mockHost(overrides = {}) {
    const writes = [];
    return {
        writes,
        getForeignStateAsync: async () => null,
        setForeignStateAsync: async (id, st) => {
            writes.push({ id, val: typeof st === "object" && st !== null ? st.val : st });
        },
        log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
        ...overrides,
    };
}
function fullDispatch() {
    const tel = {
        connected: true,
        charging: false,
        vehicleSocPct: 40,
        planSocPct: 80,
        planActive: false,
        sessionEnergyKwh: 5,
        effectivePlanTime: "2026-07-11T14:00:00.000Z",
        planTime: "2026-07-11T14:00:00.000Z",
        activePhases: 1,
        configuredPhases: 3,
        minCurrentA: 6,
        maxCurrentA: 16,
        chargePowerW: null,
        evccConfigured: true,
        mappingsReady: true,
    };
    const entry = {
        contributionId: contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
        contributor: (0, contributor_1.addonContributorRef)("wallbox"),
        slot: { startIso: SLOT_START, endIso: SLOT_END },
        status: "allocated",
        energySource: "grid",
        requestedPowerW: 3600,
        allocatedPowerW: 3600,
        requestedEnergyKwh: null,
        allocatedEnergyKwh: 0.9,
        gridPowerW: 3600,
        pvPowerW: 0,
        mandatory: false,
        priorityRank: 1,
        deadlineIso: "2026-07-11T14:00:00.000Z",
        estimatedCostCt: 12,
        reasonDe: "test",
    };
    const decision = (0, daily_plan_js_1.evaluateWallboxDailyPlan)({
        now: NOW,
        timezone: "UTC",
        meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: "UTC" },
        entries: [entry],
        telemetry: tel,
        governanceEnabled: true,
        addonEnabled: true,
    });
    const intent = (0, intent_js_1.buildWallboxDispatchIntent)({
        decision,
        governanceEnabled: true,
        addonEnabled: true,
        phases: 1,
        now: NOW,
    });
    return (0, dispatch_js_1.runWallboxDryrunDispatch)({
        intent,
        decision,
        telemetry: tel,
        config: { wb_control_model: "legacy_direct", wb_set_enabled_target: "x", wb_set_current_a_target: "y" },
        chargingEnabled: false,
        governanceEnabled: true,
    });
}
(0, node_test_1.describe)("wallbox runtime phase", () => {
    (0, node_test_1.it)("observe when governance off", () => {
        strict_1.default.equal((0, execute_js_1.resolveWallboxRuntimePhase)({ addonEnabled: true, governanceEnabled: false, liveRequested: true }), "observe");
    });
    (0, node_test_1.it)("dryrun when live not requested", () => {
        strict_1.default.equal((0, execute_js_1.resolveWallboxRuntimePhase)({ addonEnabled: true, governanceEnabled: true, liveRequested: false }), "dryrun");
    });
    (0, node_test_1.it)("live when live requested and governance on", () => {
        strict_1.default.equal((0, execute_js_1.resolveWallboxRuntimePhase)({ addonEnabled: true, governanceEnabled: true, liveRequested: true }), "live");
    });
});
(0, node_test_1.describe)("executeWallboxWrite", () => {
    (0, node_test_1.it)("release gate is open (v0.1.176, gated by liveEligible/fault/ownership)", () => {
        strict_1.default.equal(execute_js_1.WALLBOX_LIVE_WRITE_RELEASED, true);
    });
    (0, node_test_1.it)("observe does not attempt execution", async () => {
        const r = await (0, execute_js_1.executeWallboxWrite)(mockHost(), {
            candidate: chargeCandidate(),
            writePlan: null,
            phase: "observe",
            liveRequested: false,
        });
        strict_1.default.equal(r.attempted, false);
        strict_1.default.equal(r.reason, "observe_mode");
    });
    (0, node_test_1.it)("dryrun blocks without execution gate", async () => {
        const r = await (0, execute_js_1.executeWallboxWrite)(mockHost(), {
            candidate: chargeCandidate(),
            writePlan: chargeWritePlan(),
            phase: "dryrun",
            liveRequested: false,
        });
        strict_1.default.equal(r.reason, "execution_gate_closed");
    });
    (0, node_test_1.it)("live with blocked candidate stops before write plan", async () => {
        const r = await (0, execute_js_1.executeWallboxWrite)(mockHost(), {
            candidate: chargeCandidate({ blocked: true, blockReason: "vehicle_disconnected" }),
            writePlan: null,
            phase: "live",
            liveRequested: true,
        });
        strict_1.default.equal(r.reason, "vehicle_disconnected");
    });
    (0, node_test_1.it)("active fault/lockout blocks live writes", async () => {
        const host = mockHost();
        const r = await (0, execute_js_1.executeWallboxWrite)(host, {
            candidate: chargeCandidate(),
            writePlan: evccChargeWritePlan(),
            phase: "live",
            liveRequested: true,
            faultActive: true,
        });
        strict_1.default.equal(r.reason, "fault_lockout");
        strict_1.default.equal(host.writes.length, 0);
    });
    (0, node_test_1.it)("legacy_direct control model never executes (structurally not live-eligible)", async () => {
        const host = mockHost();
        const plan = chargeWritePlan();
        strict_1.default.equal(plan.liveEligible, false, "legacy_direct plans are never live-eligible");
        const r = await (0, execute_js_1.executeWallboxWrite)(host, {
            candidate: chargeCandidate(),
            writePlan: plan,
            phase: "live",
            liveRequested: true,
        });
        strict_1.default.equal(r.executed, false);
        strict_1.default.equal(r.blocked, true);
        strict_1.default.equal(host.writes.length, 0);
    });
    (0, node_test_1.it)("live EVCC charge_start writes maxCurrent then mode in sequence order", async () => {
        const host = mockHost();
        const plan = evccChargeWritePlan(chargeCandidate(), false);
        strict_1.default.equal(plan.liveEligible, true, "evcc plan with confirmed mapping must be live-eligible");
        strict_1.default.equal(plan.writeScenario, "charge_start");
        const r = await (0, execute_js_1.executeWallboxWrite)(host, {
            candidate: chargeCandidate(),
            writePlan: plan,
            phase: "live",
            liveRequested: true,
        });
        strict_1.default.equal(r.attempted, true);
        strict_1.default.equal(r.executed, true);
        strict_1.default.equal(r.blocked, false);
        strict_1.default.equal(r.ownershipGranted, true);
        strict_1.default.ok(typeof r.writeTimestampMs === "number");
        strict_1.default.equal(host.writes.length, 2);
        strict_1.default.equal(host.writes[0].id, EVCC_MAX_CURRENT);
        strict_1.default.equal(host.writes[0].val, 16);
        strict_1.default.equal(host.writes[1].id, EVCC_MODE);
        strict_1.default.equal(host.writes[1].val, "pv");
    });
    (0, node_test_1.it)("live EVCC charge_adjust (already in charge mode) writes only maxCurrent", async () => {
        const host = mockHost();
        const plan = evccChargeWritePlan(chargeCandidate(), true);
        strict_1.default.equal(plan.writeScenario, "charge_adjust");
        const r = await (0, execute_js_1.executeWallboxWrite)(host, {
            candidate: chargeCandidate(),
            writePlan: plan,
            phase: "live",
            liveRequested: true,
        });
        strict_1.default.equal(r.executed, true);
        strict_1.default.equal(host.writes.length, 1);
        strict_1.default.equal(host.writes[0].id, EVCC_MAX_CURRENT);
    });
    (0, node_test_1.it)("write already at target is executed without a real write (skipped)", async () => {
        const host = mockHost({
            getForeignStateAsync: async (id) => {
                if (id === EVCC_MAX_CURRENT)
                    return { val: 16 };
                return null;
            },
        });
        const plan = evccChargeWritePlan(chargeCandidate(), true);
        const r = await (0, execute_js_1.executeWallboxWrite)(host, {
            candidate: chargeCandidate(),
            writePlan: plan,
            phase: "live",
            liveRequested: true,
        });
        strict_1.default.equal(r.executed, true);
        strict_1.default.equal(r.reason, "already_at_target");
        strict_1.default.equal(host.writes.length, 0);
    });
    (0, node_test_1.it)("write failure blocks with write_failed and grants no ownership", async () => {
        const host = mockHost({
            setForeignStateAsync: async () => {
                throw new Error("bus down");
            },
        });
        const plan = evccChargeWritePlan(chargeCandidate(), false);
        const r = await (0, execute_js_1.executeWallboxWrite)(host, {
            candidate: chargeCandidate(),
            writePlan: plan,
            phase: "live",
            liveRequested: true,
        });
        strict_1.default.equal(r.executed, false);
        strict_1.default.equal(r.blocked, true);
        strict_1.default.equal(r.reason, "write_failed");
        strict_1.default.equal(r.ownershipGranted, false);
    });
});
(0, node_test_1.describe)("runWallboxLiveFoundation", () => {
    (0, node_test_1.it)("observe skips candidate and execution", async () => {
        const dispatch = fullDispatch();
        const decision = (0, daily_plan_js_1.evaluateWallboxDailyPlan)({
            now: NOW,
            timezone: "UTC",
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: "UTC" },
            entries: [],
            telemetry: {
                connected: true,
                charging: false,
                vehicleSocPct: 40,
                planSocPct: 80,
                planActive: false,
                sessionEnergyKwh: 5,
                effectivePlanTime: null,
                planTime: null,
                activePhases: 1,
                configuredPhases: 3,
                minCurrentA: 6,
                maxCurrentA: 16,
                chargePowerW: null,
                evccConfigured: true,
                mappingsReady: true,
            },
            governanceEnabled: false,
            addonEnabled: true,
        });
        const r = await (0, execute_js_1.runWallboxLiveFoundation)(mockHost(), {
            dispatch,
            decision,
            mappingSnapshot: testMapping(),
            chargingEnabled: false,
            chargeModeActive: null,
            config: {},
            addonEnabled: true,
            governanceEnabled: false,
            liveRequested: true,
            now: NOW,
        });
        strict_1.default.equal(r.phase, "observe");
        strict_1.default.equal(r.candidate, null);
        strict_1.default.equal(r.writePlan, null);
        strict_1.default.equal(r.feedbackContract, null);
        strict_1.default.equal(r.writeResult, null);
        strict_1.default.equal(r.writeAllowed, false);
    });
    (0, node_test_1.it)("dryrun builds candidate without execution result", async () => {
        const dispatch = fullDispatch();
        const decision = (0, daily_plan_js_1.evaluateWallboxDailyPlan)({
            now: NOW,
            timezone: "UTC",
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: "UTC" },
            entries: [{
                    contributionId: contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
                    contributor: (0, contributor_1.addonContributorRef)("wallbox"),
                    slot: { startIso: SLOT_START, endIso: SLOT_END },
                    status: "allocated",
                    energySource: "grid",
                    requestedPowerW: 3600,
                    allocatedPowerW: 3600,
                    requestedEnergyKwh: null,
                    allocatedEnergyKwh: 0.9,
                    gridPowerW: 3600,
                    pvPowerW: 0,
                    mandatory: false,
                    priorityRank: 1,
                    deadlineIso: "2026-07-11T14:00:00.000Z",
                    estimatedCostCt: 12,
                    reasonDe: "test",
                }],
            telemetry: {
                connected: true,
                charging: false,
                vehicleSocPct: 40,
                planSocPct: 80,
                planActive: false,
                sessionEnergyKwh: 5,
                effectivePlanTime: "2026-07-11T14:00:00.000Z",
                planTime: "2026-07-11T14:00:00.000Z",
                activePhases: 1,
                configuredPhases: 3,
                minCurrentA: 6,
                maxCurrentA: 16,
                chargePowerW: null,
                evccConfigured: true,
                mappingsReady: true,
            },
            governanceEnabled: true,
            addonEnabled: true,
        });
        const r = await (0, execute_js_1.runWallboxLiveFoundation)(mockHost(), {
            dispatch,
            decision,
            mappingSnapshot: testMapping(),
            chargingEnabled: false,
            chargeModeActive: null,
            config: {},
            addonEnabled: true,
            governanceEnabled: true,
            liveRequested: false,
            now: NOW,
        });
        strict_1.default.equal(r.phase, "dryrun");
        strict_1.default.ok(r.candidate);
        strict_1.default.ok(r.writePlan);
        strict_1.default.ok(r.feedbackContract);
        strict_1.default.equal(r.writeResult, null);
    });
    (0, node_test_1.it)("live with legacy_direct mapping blocks at liveEligible gate (structural)", async () => {
        const dispatch = fullDispatch();
        const decision = (0, daily_plan_js_1.evaluateWallboxDailyPlan)({
            now: NOW,
            timezone: "UTC",
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: "UTC" },
            entries: [{
                    contributionId: contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
                    contributor: (0, contributor_1.addonContributorRef)("wallbox"),
                    slot: { startIso: SLOT_START, endIso: SLOT_END },
                    status: "allocated",
                    energySource: "grid",
                    requestedPowerW: 3600,
                    allocatedPowerW: 3600,
                    requestedEnergyKwh: null,
                    allocatedEnergyKwh: 0.9,
                    gridPowerW: 3600,
                    pvPowerW: 0,
                    mandatory: false,
                    priorityRank: 1,
                    deadlineIso: "2026-07-11T14:00:00.000Z",
                    estimatedCostCt: 12,
                    reasonDe: "test",
                }],
            telemetry: {
                connected: true,
                charging: false,
                vehicleSocPct: 40,
                planSocPct: 80,
                planActive: false,
                sessionEnergyKwh: 5,
                effectivePlanTime: "2026-07-11T14:00:00.000Z",
                planTime: "2026-07-11T14:00:00.000Z",
                activePhases: 1,
                configuredPhases: 3,
                minCurrentA: 6,
                maxCurrentA: 16,
                chargePowerW: null,
                evccConfigured: true,
                mappingsReady: true,
            },
            governanceEnabled: true,
            addonEnabled: true,
        });
        const host = mockHost();
        const r = await (0, execute_js_1.runWallboxLiveFoundation)(host, {
            dispatch,
            decision,
            mappingSnapshot: testMapping(),
            chargingEnabled: false,
            chargeModeActive: null,
            config: {},
            addonEnabled: true,
            governanceEnabled: true,
            liveRequested: true,
            now: NOW,
        });
        strict_1.default.equal(r.phase, "live");
        strict_1.default.ok(r.candidate?.technicallyReady);
        strict_1.default.ok(r.writePlan?.contractReady);
        strict_1.default.equal(r.writePlan?.liveEligible, false);
        strict_1.default.equal(r.writeResult?.attempted, false);
        strict_1.default.equal(r.writeAllowed, false);
        strict_1.default.equal(host.writes.length, 0);
    });
});
