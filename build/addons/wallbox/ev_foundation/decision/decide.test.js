"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = require("node:test");
const execution_mode_1 = require("../../../../execution_mode");
const tree_paths_1 = require("../../../../tree_paths");
const write_allowlist_1 = require("../write_allowlist");
const ensure_states_1 = require("../ensure_states");
const index_1 = require("./index");
const SRC = (0, node_path_1.join)(__dirname, "..", "..", "..", "..", "..", "src", "addons", "wallbox");
const DECISION_SRC = (0, node_path_1.join)(SRC, "ev_foundation", "decision");
const NOW_ISO = "2026-08-13T10:00:00.000Z";
const NOW = Date.parse(NOW_ISO);
function slot(start, end, powerKw = 11, energyKWh = null) {
    return {
        start,
        end,
        plannedPowerKw: powerKw,
        plannedEnergyKWh: energyKWh,
        source: "external",
        quality: "ok",
    };
}
function hourWindow(startIso, hours, ct) {
    const startMs = Date.parse(startIso);
    return { startMs, endMs: startMs + hours * 3_600_000, importCtPerKwh: ct };
}
function baseModel(over = {}) {
    const minimumDepartureSocPct = over.minimumDepartureSocPct !== undefined ? over.minimumDepartureSocPct : null;
    return {
        evccConnected: true,
        vehicleConnected: true,
        charging: false,
        chargePowerW: 0,
        evccMode: "pv",
        phasesConfigured: 3,
        phasesActive: 0,
        maxCurrentA: 16,
        minCurrentA: 6,
        effectiveMaxCurrentA: 16,
        offeredCurrentA: 16,
        vehicleSocPct: 50,
        targetSocPct: 90,
        minimumDepartureSocPct,
        departureAt: null,
        batteryCapacityKWh: 77,
        maxAcChargePowerKw: 11,
        chargingEfficiency: 0.9,
        safetyMarginMin: 15,
        vehicleAvailableUntil: null,
        externalControlEnabled: true,
        externalControlType: "vehicle",
        externalControlActive: true,
        externalControlConfigured: true,
        externalSmartPlanAvailable: false,
        externalSmartPlanSlots: null,
        externalPlanRemainingEnergyKWh: null,
        externalPlanRemainingMinutes: null,
        externalPlanDeadlineUsed: false,
        gridRewardsActive: false,
        smartChargingActive: true,
        externalSourceQuality: "ok",
        externalSourceUpdatedAt: NOW_ISO,
        externalSourceHealthy: true,
        manualOverrideActive: null,
        emsTakeoverActive: false,
        preparedEvState: "pv",
        recommendedEvState: "pv",
        externalAuthorityState: "unknown",
        takeoverSeverity: "none",
        takeoverRecommended: false,
        takeoverRequired: false,
        takeoverReason: null,
        vehicleDetectionActive: true,
        dataQuality: "ok",
        vehicleSocQuality: "valid",
        externalSmartChargingMinSocPct: 25,
        externalSmartChargingMinSocQuality: "valid",
        vehicleModelSource: "ev_model_v1",
        vehicleModelReady: true,
        controlContractModel: "evcc_buttons",
        evccControlContractReady: true,
        legacyDirectControlPresent: false,
        evccModeControlVariant: "buttons",
        evccModeFeedbackState: "evcc.0.loadpoint.1.status.mode",
        evccModeButtonsReady: true,
        evccModeOffTargetReady: true,
        evccModePvTargetReady: true,
        evccModeMinTargetReady: true,
        evccModeNowTargetReady: true,
        ...over,
        departureMinSocConfigured: over.departureMinSocConfigured ??
            (over.minimumDepartureSocPct !== undefined
                ? over.minimumDepartureSocPct != null
                : minimumDepartureSocPct != null),
    };
}
function decide(over = {}, extra = {}) {
    const model = baseModel(over);
    const decision = (0, index_1.evaluateEvTakeoverDecision)({
        model,
        nowMs: extra.nowMs ?? NOW,
        priceWindows: extra.priceWindows,
        externalDeadlineIso: extra.externalDeadlineIso,
    });
    const diagnosed = (0, index_1.applyEvTakeoverDiagnosis)(model, decision);
    return { model, decision, diagnosed };
}
function noActuation(diagnosed) {
    strict_1.default.equal(diagnosed.emsTakeoverActive, false);
    strict_1.default.equal(diagnosed.preparedEvState, "pv");
    strict_1.default.ok(!["external", "ems_takeover", "manual_override"].includes(diagnosed.preparedEvState));
}
(0, node_test_1.describe)("EV foundation Phase 3 takeover decision (diagnostic)", () => {
    (0, node_test_1.it)("T1: external active + sufficient smart plan → no takeover", () => {
        const { decision, diagnosed } = decide({
            vehicleSocPct: 30,
            minimumDepartureSocPct: 70,
            departureAt: "2026-08-13T18:00:00.000Z",
            gridRewardsActive: true,
            smartChargingActive: true,
            externalSmartPlanAvailable: true,
            externalSmartPlanSlots: [slot("2026-08-13T10:00:00.000Z", "2026-08-13T16:00:00.000Z", 11)],
        });
        strict_1.default.equal(decision.externalAuthorityState, "active");
        strict_1.default.equal(decision.externalPlanCoversDepartureMinimum, true);
        strict_1.default.equal(decision.takeoverRequired, false);
        strict_1.default.equal(decision.takeoverRecommended, false);
        strict_1.default.equal(decision.takeoverSeverity, "none");
        strict_1.default.equal(decision.takeoverReason, null);
        strict_1.default.equal(decision.outcome, "external");
        strict_1.default.equal(diagnosed.recommendedEvState, "external");
        noActuation(diagnosed);
    });
    (0, node_test_1.it)("T2: Grid Rewards false alone → no takeover", () => {
        const { decision, diagnosed } = decide({
            gridRewardsActive: false,
            smartChargingActive: true,
            externalControlActive: true,
            externalSmartPlanAvailable: false,
        });
        strict_1.default.equal(decision.takeoverRequired, false);
        strict_1.default.equal(decision.takeoverRecommended, false);
        strict_1.default.notEqual(decision.takeoverReason, "external_unavailable");
        strict_1.default.notEqual(decision.outcome, "ems_takeover_required");
        noActuation(diagnosed);
    });
    (0, node_test_1.it)("T3: smart plan missing + no deadline → no takeover", () => {
        const { decision, diagnosed } = decide({
            externalSmartPlanAvailable: false,
            externalSmartPlanSlots: null,
            departureAt: null,
            minimumDepartureSocPct: 70,
            vehicleSocPct: 30,
        });
        strict_1.default.equal(decision.latestRequiredStart, null);
        strict_1.default.equal(decision.deadlineRisk, false);
        strict_1.default.equal(decision.takeoverRequired, false);
        strict_1.default.notEqual(decision.outcome, "ems_takeover_required");
        noActuation(diagnosed);
    });
    (0, node_test_1.it)("T4: departure-minimum null → no fake hard requirement", () => {
        const { decision } = decide({
            minimumDepartureSocPct: null,
            vehicleSocPct: 30,
            targetSocPct: 90,
        });
        strict_1.default.equal(decision.energyToDepartureMinimumKWh, null);
        strict_1.default.notEqual(decision.energyToDepartureMinimumKWh, 0);
    });
    (0, node_test_1.it)("T5: departureAt null → latestRequiredStart null", () => {
        const { decision } = decide({
            departureAt: null,
            vehicleAvailableUntil: null,
            minimumDepartureSocPct: 70,
            vehicleSocPct: 30,
        });
        strict_1.default.equal(decision.latestRequiredStart, null);
    });
    (0, node_test_1.it)("T6: target 90% alone creates no deadline", () => {
        const { decision } = decide({
            vehicleSocPct: 40,
            targetSocPct: 90,
            minimumDepartureSocPct: null,
            departureAt: null,
        });
        strict_1.default.equal(decision.deadlineIso, null);
        strict_1.default.equal(decision.latestRequiredStart, null);
        strict_1.default.equal(decision.deadlineRisk, false);
        strict_1.default.equal(decision.takeoverRequired, false);
        strict_1.default.ok(decision.energyToTargetKWh != null && decision.energyToTargetKWh > 0);
    });
    (0, node_test_1.it)("T7: Tibber-minimum 25% is not departure-minimum", () => {
        const { decision } = decide({
            externalSmartChargingMinSocPct: 25,
            minimumDepartureSocPct: null,
            vehicleSocPct: 40,
        });
        strict_1.default.equal(decision.energyToDepartureMinimumKWh, null);
        strict_1.default.equal(decision.explain.externalSmartChargingMinSocPct, 25);
        strict_1.default.equal(decision.explain.minimumDepartureSocPct, null);
        strict_1.default.notEqual(decision.energyToTargetKWh, decision.energyToDepartureMinimumKWh);
    });
    (0, node_test_1.it)("T8: external plan covers departure-minimum → no required takeover", () => {
        const { decision, diagnosed } = decide({
            vehicleSocPct: 30,
            minimumDepartureSocPct: 70,
            departureAt: "2026-08-13T18:00:00.000Z",
            externalSmartPlanAvailable: true,
            gridRewardsActive: true,
            externalSmartPlanSlots: [slot("2026-08-13T10:00:00.000Z", "2026-08-13T16:00:00.000Z", 11)],
        });
        strict_1.default.equal(decision.externalPlanCoversDepartureMinimum, true);
        strict_1.default.equal(decision.takeoverRequired, false);
        strict_1.default.notEqual(decision.takeoverReason, "insufficient_external_plan");
        noActuation(diagnosed);
    });
    (0, node_test_1.it)("T9: external plan does not cover real requirement → insufficient_external_plan", () => {
        const { decision, diagnosed } = decide({
            vehicleSocPct: 30,
            minimumDepartureSocPct: 70,
            departureAt: "2026-08-13T18:00:00.000Z",
            externalSmartPlanAvailable: true,
            externalSmartPlanSlots: [slot("2026-08-13T10:00:00.000Z", "2026-08-13T10:30:00.000Z", 11)],
        });
        strict_1.default.equal(decision.externalPlanCoversDepartureMinimum, false);
        strict_1.default.equal(decision.takeoverReason, "insufficient_external_plan");
        strict_1.default.equal(decision.takeoverRequired, true);
        strict_1.default.equal(decision.takeoverSeverity, "required");
        strict_1.default.equal(diagnosed.recommendedEvState, "ems_takeover");
        strict_1.default.equal(diagnosed.preparedEvState, "pv");
        strict_1.default.equal(diagnosed.emsTakeoverActive, false);
    });
    (0, node_test_1.it)("T10: deadline physically at risk → deadline_risk / required", () => {
        const nowMs = Date.parse("2026-08-13T04:00:00.000Z");
        const { decision, diagnosed } = decide({
            vehicleSocPct: 30,
            minimumDepartureSocPct: 70,
            departureAt: "2026-08-13T06:00:00.000Z",
            batteryCapacityKWh: 77,
            maxAcChargePowerKw: 11,
            chargingEfficiency: 0.9,
            externalSmartPlanAvailable: false,
        }, { nowMs });
        strict_1.default.equal(decision.deadlineRisk, true);
        strict_1.default.equal(decision.takeoverSeverity, "required");
        strict_1.default.equal(decision.takeoverReason, "deadline_risk");
        strict_1.default.equal(decision.takeoverRequired, true);
        strict_1.default.equal(diagnosed.recommendedEvState, "ems_takeover");
        strict_1.default.equal(diagnosed.emsTakeoverActive, false);
    });
    (0, node_test_1.it)("T11: cheap window about to be lost → economic_window_loss / recommended", () => {
        const nowMs = Date.parse("2026-08-12T21:00:00.000Z");
        const { decision, diagnosed } = decide({
            vehicleSocPct: 30,
            minimumDepartureSocPct: 70,
            departureAt: "2026-08-13T06:00:00.000Z",
            externalSmartPlanAvailable: false,
        }, {
            nowMs,
            priceWindows: [
                hourWindow("2026-08-12T21:00:00.000Z", 1, 40),
                hourWindow("2026-08-12T22:00:00.000Z", 3, 10),
                hourWindow("2026-08-13T01:00:00.000Z", 5, 40),
            ],
        });
        strict_1.default.equal(decision.deadlineRisk, false);
        strict_1.default.equal(decision.economicWindowLossRisk, true);
        strict_1.default.equal(decision.takeoverReason, "economic_window_loss");
        strict_1.default.equal(decision.takeoverSeverity, "recommended");
        strict_1.default.equal(decision.takeoverRequired, false);
        strict_1.default.equal(decision.takeoverRecommended, true);
        strict_1.default.equal(diagnosed.preparedEvState, "pv");
        strict_1.default.equal(diagnosed.emsTakeoverActive, false);
    });
    (0, node_test_1.it)("T12: physically reachable, economically bad → recommended, not required", () => {
        const nowMs = Date.parse("2026-08-12T21:00:00.000Z");
        const { decision } = decide({
            vehicleSocPct: 30,
            minimumDepartureSocPct: 70,
            departureAt: "2026-08-13T06:00:00.000Z",
            externalSmartPlanAvailable: false,
        }, {
            nowMs,
            priceWindows: [
                hourWindow("2026-08-12T21:00:00.000Z", 1, 40),
                hourWindow("2026-08-12T22:00:00.000Z", 3, 10),
                hourWindow("2026-08-13T01:00:00.000Z", 5, 40),
            ],
        });
        strict_1.default.equal(decision.deadlineRisk, false);
        strict_1.default.ok((decision.remainingFeasibleEnergyKWh ?? 0) > (decision.energyToDepartureMinimumKWh ?? 0));
        strict_1.default.equal(decision.takeoverSeverity, "recommended");
        strict_1.default.equal(decision.takeoverRequired, false);
        strict_1.default.equal(decision.outcome, "ems_takeover_recommended");
    });
    (0, node_test_1.it)("T13: no smart-plan, but enough time → observe", () => {
        const nowMs = Date.parse("2026-08-12T22:00:00.000Z");
        const { decision, diagnosed } = decide({
            vehicleSocPct: 30,
            minimumDepartureSocPct: 70,
            departureAt: "2026-08-13T06:00:00.000Z",
            externalSmartPlanAvailable: false,
        }, { nowMs });
        strict_1.default.equal(decision.deadlineRisk, false);
        strict_1.default.equal(decision.takeoverRequired, false);
        strict_1.default.equal(decision.takeoverRecommended, false);
        strict_1.default.equal(decision.takeoverSeverity, "observe");
        strict_1.default.equal(decision.outcome, "external");
        noActuation(diagnosed);
    });
    (0, node_test_1.it)("T14: external source missing despite expected authority → external_unavailable", () => {
        const { decision, diagnosed } = decide({
            externalControlConfigured: true,
            externalControlEnabled: true,
            externalControlType: "vehicle",
            externalSourceQuality: "stale",
            externalSourceHealthy: false,
            gridRewardsActive: null,
            smartChargingActive: null,
            externalControlActive: null,
            externalSmartPlanAvailable: false,
        });
        strict_1.default.equal(decision.externalAuthorityState, "unavailable");
        strict_1.default.equal(decision.takeoverReason, "external_unavailable");
        strict_1.default.equal(decision.takeoverRequired, false);
        strict_1.default.equal(decision.takeoverSeverity, "observe");
        noActuation(diagnosed);
    });
    (0, node_test_1.it)("T15: vehicle SOC unknown → no invented energy", () => {
        const { decision } = decide({
            vehicleSocPct: null,
            vehicleSocQuality: "unknown",
            targetSocPct: 90,
            minimumDepartureSocPct: 70,
        });
        strict_1.default.equal(decision.energyToTargetKWh, null);
        strict_1.default.equal(decision.energyToDepartureMinimumKWh, null);
        strict_1.default.notEqual(decision.energyToTargetKWh, 0);
    });
    (0, node_test_1.it)("T16: capacity unknown → no fake kWh", () => {
        const { decision } = decide({
            batteryCapacityKWh: null,
            vehicleSocPct: 30,
            targetSocPct: 90,
        });
        strict_1.default.equal(decision.energyToTargetKWh, null);
        strict_1.default.notEqual(decision.energyToTargetKWh, 0);
    });
    (0, node_test_1.it)("T17: max AC unknown → no fake charge time", () => {
        const { decision } = decide({
            maxAcChargePowerKw: null,
            maxCurrentA: null,
            effectiveMaxCurrentA: null,
            offeredCurrentA: null,
            phasesConfigured: null,
            phasesActive: null,
            vehicleSocPct: 30,
            targetSocPct: 90,
        });
        strict_1.default.equal(decision.chargePower.chargePowerKw, null);
        strict_1.default.equal(decision.requiredChargingMinutes, null);
        strict_1.default.equal(decision.latestRequiredStart, null);
    });
    (0, node_test_1.it)("T18: running smart-plan slot counted only in remaining fraction", () => {
        const nowMs = Date.parse("2026-08-13T13:00:00.000Z");
        const { decision } = decide({
            externalSmartPlanAvailable: true,
            externalSmartPlanSlots: [
                slot("2026-08-13T12:00:00.000Z", "2026-08-13T14:00:00.000Z", 11, 22),
            ],
        }, { nowMs });
        strict_1.default.equal(decision.explain.externalPlanRemainingEnergyKWh, 11);
    });
    (0, node_test_1.it)("T19: overlapping slots are not double-counted", () => {
        const nowMs = Date.parse("2026-08-13T12:00:00.000Z");
        const { decision } = decide({
            externalSmartPlanAvailable: true,
            externalSmartPlanSlots: [
                slot("2026-08-13T12:00:00.000Z", "2026-08-13T14:00:00.000Z", 11),
                slot("2026-08-13T13:00:00.000Z", "2026-08-13T15:00:00.000Z", 11),
            ],
        }, { nowMs });
        strict_1.default.equal(decision.explain.externalPlanRemainingEnergyKWh, 33);
    });
    (0, node_test_1.it)("T20: safety margin is included in latestRequiredStart", () => {
        const nowMs = Date.parse("2026-08-13T00:00:00.000Z");
        const energy = (0, index_1.energyForSocDeltaKwh)({
            vehicleSocPct: 30,
            targetSocPct: 70,
            batteryCapacityKWh: 77,
            chargingEfficiency: 0.9,
        });
        const minutes = (0, index_1.chargingMinutesForEnergy)(energy, 11);
        strict_1.default.ok(minutes != null);
        const deadline = Date.parse("2026-08-13T06:00:00.000Z");
        const { decision } = decide({
            vehicleSocPct: 30,
            minimumDepartureSocPct: 70,
            departureAt: "2026-08-13T06:00:00.000Z",
            safetyMarginMin: 15,
        }, { nowMs });
        strict_1.default.ok(decision.latestRequiredStart);
        const latest = Date.parse(decision.latestRequiredStart);
        const withoutMargin = deadline - minutes * 60_000;
        strict_1.default.equal(withoutMargin - latest, 15 * 60_000);
    });
    (0, node_test_1.it)("T21: no EVCC write from decision / refresh path", () => {
        strict_1.default.equal(write_allowlist_1.EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
        const executeSrc = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "runtime", "execute.ts"), "utf8");
        strict_1.default.equal(executeSrc.includes("prepareEvccButtonTrigger"), false);
        for (const file of [
            "decide.ts",
            "authority.ts",
            "energy.ts",
            "latest_start.ts",
            "plan_coverage.ts",
            "price_windows.ts",
            "index.ts",
        ]) {
            const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(DECISION_SRC, file), "utf8");
            strict_1.default.equal(src.includes("setForeignState"), false);
            strict_1.default.equal(src.includes("writeForeignIfChanged"), false);
            strict_1.default.equal(src.includes("prepareEvccButtonTrigger"), false);
            strict_1.default.equal(src.includes("control.off"), false);
        }
    });
    (0, node_test_1.it)("T22: no Sonnen write", () => {
        for (const file of ["decide.ts", "authority.ts", "index.ts"]) {
            const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(DECISION_SRC, file), "utf8");
            strict_1.default.equal(src.includes("setForeignState"), false);
            strict_1.default.equal(src.includes("writeForeignIfChanged"), false);
            strict_1.default.equal(/sonnen\.\d/i.test(src), false);
        }
    });
    (0, node_test_1.it)("T23: no go-e write", () => {
        for (const file of ["decide.ts", "authority.ts", "index.ts"]) {
            const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(DECISION_SRC, file), "utf8");
            strict_1.default.equal(src.includes("setForeignState"), false);
            strict_1.default.equal(/go[-_]?e\.\d/i.test(src), false);
        }
    });
    (0, node_test_1.it)("T24: governance unchanged", async () => {
        const store = {
            [tree_paths_1.GLOBAL.executionMode]: "dryrun",
            [(0, tree_paths_1.addonMode)("wallbox")]: "live",
        };
        const get = async (id) => ({ val: store[id] });
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "wallbox"), false);
        store[tree_paths_1.GLOBAL.executionMode] = "live";
        store[(0, tree_paths_1.addonMode)("wallbox")] = "dryrun";
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "wallbox"), false);
        store[(0, tree_paths_1.addonMode)("wallbox")] = "live";
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(get, "wallbox"), true);
    });
    (0, node_test_1.it)("T25: real install — no artificial deadline, Tibber min ≠ departure min, no writes", () => {
        for (const gridRewardsActive of [true, false]) {
            const { decision, diagnosed } = decide({
                batteryCapacityKWh: 77,
                maxAcChargePowerKw: 11,
                targetSocPct: 90,
                externalSmartChargingMinSocPct: 25,
                minimumDepartureSocPct: null,
                departureAt: null,
                externalControlConfigured: true,
                externalControlEnabled: true,
                gridRewardsActive,
                externalSmartPlanAvailable: false,
                externalSmartPlanSlots: null,
            });
            strict_1.default.equal(decision.latestRequiredStart, null);
            strict_1.default.equal(decision.deadlineRisk, false);
            strict_1.default.equal(decision.takeoverRequired, false);
            strict_1.default.notEqual(decision.takeoverReason, "deadline_risk");
            strict_1.default.equal(decision.energyToDepartureMinimumKWh, null);
            strict_1.default.equal(decision.explain.externalSmartChargingMinSocPct, 25);
            strict_1.default.equal(diagnosed.emsTakeoverActive, false);
            strict_1.default.equal(diagnosed.preparedEvState, "pv");
        }
        strict_1.default.equal(write_allowlist_1.EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
        strict_1.default.ok(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.takeoverDecisionJson.endsWith("takeover_decision_json"));
        strict_1.default.ok(ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.recommendedEvState.endsWith("recommended_ev_state"));
    });
    (0, node_test_1.it)("reliable smart plan covering the requirement suppresses price-heuristic takeover", () => {
        const nowMs = Date.parse("2026-08-12T21:00:00.000Z");
        const { decision } = decide({
            vehicleSocPct: 30,
            minimumDepartureSocPct: 70,
            departureAt: "2026-08-13T06:00:00.000Z",
            gridRewardsActive: true,
            externalSmartPlanAvailable: true,
            externalSmartPlanSlots: [
                slot("2026-08-12T22:00:00.000Z", "2026-08-13T02:00:00.000Z", 11),
            ],
        }, {
            nowMs,
            priceWindows: [
                hourWindow("2026-08-12T21:00:00.000Z", 1, 40),
                hourWindow("2026-08-12T22:00:00.000Z", 3, 10),
                hourWindow("2026-08-13T01:00:00.000Z", 5, 40),
            ],
        });
        strict_1.default.equal(decision.externalPlanCoversDepartureMinimum, true);
        strict_1.default.equal(decision.takeoverRecommended, false);
        strict_1.default.equal(decision.takeoverRequired, false);
        strict_1.default.equal(decision.takeoverSeverity, "none");
        strict_1.default.notEqual(decision.takeoverReason, "economic_window_loss");
    });
});
