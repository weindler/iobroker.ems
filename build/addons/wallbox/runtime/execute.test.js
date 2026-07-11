"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const contribution_ids_1 = require("../../../operator/contribution_ids");
const contributor_1 = require("../../../operator/contributor");
const slots_1 = require("../../../operator/daily_plan/slots");
const time_1 = require("../../../operator/time");
const daily_plan_js_1 = require("./daily_plan.js");
const intent_js_1 = require("./intent.js");
const dispatch_js_1 = require("./dispatch.js");
const execute_js_1 = require("./execute.js");
const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = (0, slots_1.slotStartIsoFloored)(NOW, "UTC");
const SLOT_END = (0, time_1.isoFromMs)(Date.parse(SLOT_START) + slots_1.DAILY_PLAN_SLOT_MS);
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
        config: { wb_set_enabled_target: "x", wb_set_current_a_target: "y" },
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
    (0, node_test_1.it)("never executes external write in v0.1.134", async () => {
        const r = await (0, execute_js_1.executeWallboxWrite)({
            candidate: chargeCandidate(),
            phase: "live",
            liveRequested: true,
        });
        strict_1.default.equal(r.attempted, false, "function invocation alone is not an external write attempt");
        strict_1.default.equal(r.executed, false);
        strict_1.default.equal(r.blocked, true);
        strict_1.default.equal(r.reason, "release_gate_closed");
    });
    (0, node_test_1.it)("observe does not attempt execution", async () => {
        const r = await (0, execute_js_1.executeWallboxWrite)({
            candidate: chargeCandidate(),
            phase: "observe",
            liveRequested: false,
        });
        strict_1.default.equal(r.attempted, false);
        strict_1.default.equal(r.reason, "observe_mode");
    });
    (0, node_test_1.it)("dryrun blocks without release gate", async () => {
        const r = await (0, execute_js_1.executeWallboxWrite)({
            candidate: chargeCandidate(),
            phase: "dryrun",
            liveRequested: false,
        });
        strict_1.default.equal(r.reason, "execution_gate_closed");
    });
    (0, node_test_1.it)("live with blocked candidate stops before release gate", async () => {
        const r = await (0, execute_js_1.executeWallboxWrite)({
            candidate: chargeCandidate({ blocked: true, blockReason: "vehicle_disconnected" }),
            phase: "live",
            liveRequested: true,
        });
        strict_1.default.equal(r.reason, "vehicle_disconnected");
    });
    (0, node_test_1.it)("release gate is closed", () => {
        strict_1.default.equal(execute_js_1.WALLBOX_LIVE_WRITE_RELEASED, false);
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
        const r = await (0, execute_js_1.runWallboxLiveFoundation)({
            dispatch,
            decision,
            addonEnabled: true,
            governanceEnabled: false,
            liveRequested: true,
            now: NOW,
        });
        strict_1.default.equal(r.phase, "observe");
        strict_1.default.equal(r.candidate, null);
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
        const r = await (0, execute_js_1.runWallboxLiveFoundation)({
            dispatch,
            decision,
            addonEnabled: true,
            governanceEnabled: true,
            liveRequested: false,
            now: NOW,
        });
        strict_1.default.equal(r.phase, "dryrun");
        strict_1.default.ok(r.candidate);
        strict_1.default.equal(r.writeResult, null);
    });
    (0, node_test_1.it)("live routes to execute and blocks at release gate", async () => {
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
        const r = await (0, execute_js_1.runWallboxLiveFoundation)({
            dispatch,
            decision,
            addonEnabled: true,
            governanceEnabled: true,
            liveRequested: true,
            now: NOW,
        });
        strict_1.default.equal(r.phase, "live");
        strict_1.default.ok(r.candidate?.technicallyReady);
        strict_1.default.equal(r.writeResult?.reason, "release_gate_closed");
        strict_1.default.equal(r.writeResult?.attempted, false);
        strict_1.default.equal(r.writeAllowed, false);
    });
});
(0, node_test_1.describe)("wallbox execute write safety", () => {
    (0, node_test_1.it)("execute module has no foreign write imports", () => {
        const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), "src/addons/wallbox/runtime/execute.ts"), "utf8");
        strict_1.default.ok(!/import\s*\{[^}]*writeForeignIfChanged/.test(src));
        strict_1.default.ok(!/import\s*\{[^}]*setForeignStateAsync/.test(src));
        strict_1.default.ok(!/from\s+["'].*failsafe/.test(src));
        strict_1.default.ok(!src.includes("writeForeignIfChanged("));
        strict_1.default.ok(!src.includes("setForeignStateAsync("));
    });
    (0, node_test_1.it)("valid charge candidate in live still produces zero writes via execute", async () => {
        const r = await (0, execute_js_1.executeWallboxWrite)({
            candidate: chargeCandidate(),
            phase: "live",
            liveRequested: true,
        });
        strict_1.default.equal(r.executed, false);
    });
});
