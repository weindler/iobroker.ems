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
const command_js_1 = require("./command.js");
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
        planActive: false,
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
function allocationEntry(allocatedPowerW) {
    return {
        contributionId: contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
        contributor: (0, contributor_1.addonContributorRef)("wallbox"),
        slot: { startIso: SLOT_START, endIso: SLOT_END },
        status: "allocated",
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
        estimatedCostCt: 12,
        reasonDe: "test",
    };
}
function pipeline(entries, tel = telemetry(), config = {}) {
    const decision = (0, daily_plan_js_1.evaluateWallboxDailyPlan)({
        now: NOW,
        timezone: TZ,
        meta: { status: "ready", date: "2026-07-11", revision: 4, validUntil: null, timezone: TZ },
        entries,
        telemetry: tel,
        governanceEnabled: true,
        addonEnabled: true,
    });
    const intent = (0, intent_js_1.buildWallboxDispatchIntent)({
        decision,
        governanceEnabled: true,
        addonEnabled: true,
        phases: tel.activePhases ?? tel.configuredPhases,
        now: NOW,
    });
    const dispatch = (0, dispatch_js_1.runWallboxDryrunDispatch)({
        intent,
        decision,
        telemetry: tel,
        config,
        chargingEnabled: false,
        governanceEnabled: true,
    });
    const candidate = (0, command_js_1.buildWallboxCommandCandidate)({ dispatch, decision, now: NOW });
    return { decision, dispatch, candidate };
}
(0, node_test_1.describe)("wallbox command candidate", () => {
    (0, node_test_1.it)("none produces no executable charge", () => {
        const { candidate } = pipeline([], telemetry({ connected: false }));
        strict_1.default.equal(candidate.action, "none");
        strict_1.default.equal(candidate.technicallyReady, false);
        strict_1.default.equal(candidate.blocked, true);
    });
    (0, node_test_1.it)("hold produces no positive charge power", () => {
        const { candidate } = pipeline([]);
        strict_1.default.equal(candidate.action, "hold");
        strict_1.default.equal(candidate.targetPowerW, 0);
        strict_1.default.equal(candidate.blocked, true);
        strict_1.default.equal(candidate.blockReason, "hold_requested");
    });
    (0, node_test_1.it)("valid charge produces neutral candidate", () => {
        const { candidate } = pipeline([allocationEntry(3600)], telemetry(), {
            wb_control_model: "legacy_direct",
            wb_set_enabled_target: "go-e.0.allow_charging",
            wb_set_current_a_target: "go-e.0.ampere",
        });
        strict_1.default.equal(candidate.action, "charge");
        strict_1.default.equal(candidate.technicallyReady, true);
        strict_1.default.equal(candidate.blocked, false);
        strict_1.default.equal(candidate.targetPowerW, 3600);
        strict_1.default.ok(candidate.targetCurrentA !== null && candidate.targetCurrentA > 0);
    });
    (0, node_test_1.it)("charge blocked when disconnected", () => {
        const { candidate } = pipeline([allocationEntry(3600)], telemetry({ connected: false, vehicleSocPct: 0 }));
        strict_1.default.equal(candidate.action, "none");
        strict_1.default.equal(candidate.blocked, true);
        strict_1.default.equal(candidate.blockReason, "vehicle_disconnected");
    });
    (0, node_test_1.it)("soc 0 when disconnected is not an error path", () => {
        const { candidate } = pipeline([allocationEntry(3600)], telemetry({ connected: false, vehicleSocPct: 0 }));
        strict_1.default.equal(candidate.blockReason, "vehicle_disconnected");
        strict_1.default.notEqual(candidate.blockReason, "invalid_target_power");
    });
    (0, node_test_1.it)("mapping incomplete sets not ready", () => {
        const { candidate } = pipeline([allocationEntry(3600)], telemetry(), {});
        strict_1.default.equal(candidate.technicallyReady, false);
        strict_1.default.equal(candidate.blocked, true);
        strict_1.default.equal(candidate.blockReason, "mapping_incomplete");
    });
    (0, node_test_1.it)("rejects non-finite target power", () => {
        const decision = (0, daily_plan_js_1.evaluateWallboxDailyPlan)({
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [allocationEntry(3600)],
            telemetry: telemetry(),
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
        const dispatch = (0, dispatch_js_1.runWallboxDryrunDispatch)({
            intent,
            decision,
            telemetry: telemetry(),
            config: {
                wb_control_model: "legacy_direct",
                wb_set_enabled_target: "x",
                wb_set_current_a_target: "y",
            },
            chargingEnabled: false,
            governanceEnabled: true,
        });
        dispatch.target.targetPowerW = Number.NaN;
        dispatch.intent.action = "charge";
        const candidate = (0, command_js_1.buildWallboxCommandCandidate)({ dispatch, decision, now: NOW });
        strict_1.default.equal(candidate.technicallyReady, false);
        strict_1.default.equal(candidate.blockReason, "invalid_target_power");
    });
    (0, node_test_1.it)("rejects negative target current", () => {
        const { decision, dispatch } = pipeline([allocationEntry(3600)], telemetry(), {
            wb_control_model: "legacy_direct",
            wb_set_enabled_target: "x",
            wb_set_current_a_target: "y",
        });
        dispatch.target.targetCurrentA = -1;
        const candidate = (0, command_js_1.buildWallboxCommandCandidate)({ dispatch, decision, now: NOW });
        strict_1.default.equal(candidate.technicallyReady, false);
        strict_1.default.equal(candidate.blockReason, "invalid_target_current");
    });
});
