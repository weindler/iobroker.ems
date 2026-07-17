"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const mode_js_1 = require("./mode.js");
const policy_js_1 = require("../planner_publish/policy.js");
const build_js_1 = require("../planner_candidate/build.js");
const candidate_compare_js_1 = require("./candidate_compare.js");
const builder_js_1 = require("../planner_snapshot/builder.js");
const parity_fixture_js_1 = require("../planner_snapshot/parity_fixture.js");
(0, node_test_1.describe)("planner_shadow mode resolution", () => {
    (0, node_test_1.it)("persisted shadow_enabled cannot activate when native is off", () => {
        const effective = (0, mode_js_1.resolveEffectivePlannerMode)({
            config: { planner_runtime_mode: "off" },
            sessionShadowEnabled: true,
        });
        strict_1.default.equal(effective.effectiveMode, "off");
        strict_1.default.equal(effective.coordinatorEnabled, false);
    });
    (0, node_test_1.it)("native shadow_manual arms session initially", () => {
        strict_1.default.equal((0, mode_js_1.initialSessionShadowFromNative)("shadow_manual"), true);
        strict_1.default.equal((0, mode_js_1.initialSessionShadowFromNative)("off"), false);
        const effective = (0, mode_js_1.resolveEffectivePlannerMode)({
            config: { planner_runtime_mode: "shadow_manual" },
            sessionShadowEnabled: true,
        });
        strict_1.default.equal(effective.effectiveMode, "shadow_manual");
        strict_1.default.equal(effective.allowsAuto, false);
        strict_1.default.equal(effective.allowsManual, true);
    });
    (0, node_test_1.it)("session disable pauses native shadow without changing config", () => {
        const effective = (0, mode_js_1.resolveEffectivePlannerMode)({
            config: { planner_runtime_mode: "shadow_auto" },
            sessionShadowEnabled: false,
        });
        strict_1.default.equal(effective.configuredMode, "shadow_auto");
        strict_1.default.equal(effective.effectiveMode, "off");
    });
});
(0, node_test_1.describe)("planner_publish gate", () => {
    (0, node_test_1.it)("blocks canonical even in shadow_auto simulation", () => {
        const decision = (0, policy_js_1.resolvePlannerPublishTarget)({
            requestedTarget: "canonical",
            jobMode: "simulation",
            releaseGate: policy_js_1.PHASE_3E_PUBLISH_DEFAULTS.releaseGate,
            candidateValid: true,
            generationMatches: true,
            inputRevisionMatches: true,
            shuttingDown: false,
            productiveTakeoverMode: policy_js_1.PHASE_3E_PUBLISH_DEFAULTS.productiveTakeoverMode,
        });
        strict_1.default.equal(decision.allowed, false);
        strict_1.default.equal(decision.target, "blocked_canonical");
    });
    (0, node_test_1.it)("allows candidate target", () => {
        const decision = (0, policy_js_1.resolvePlannerPublishTarget)({
            requestedTarget: "candidate",
            jobMode: "simulation",
            releaseGate: "closed",
            candidateValid: true,
            generationMatches: true,
            inputRevisionMatches: true,
            shuttingDown: false,
            productiveTakeoverMode: false,
        });
        strict_1.default.equal(decision.allowed, true);
        strict_1.default.equal(decision.target, "candidate");
    });
});
(0, node_test_1.describe)("planner_shadow candidate compare", () => {
    (0, node_test_1.it)("identical candidates match", async () => {
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        const a = (0, build_js_1.buildPlanCandidateFromSnapshot)(snapshot).candidate;
        const b = (0, build_js_1.buildPlanCandidateFromSnapshot)(snapshot).candidate;
        const result = (0, candidate_compare_js_1.comparePlanCandidates)(a, b);
        strict_1.default.equal(result.status, "matched");
        strict_1.default.equal(result.mismatchCount, 0);
    });
    (0, node_test_1.it)("slot deviation yields mismatch with domain", async () => {
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        const reference = (0, build_js_1.buildPlanCandidateFromSnapshot)(snapshot).candidate;
        const worker = structuredClone(reference);
        if (worker.forecastSlots[0]) {
            worker.forecastSlots[0].pvPowerW = (worker.forecastSlots[0].pvPowerW ?? 0) + 99;
        }
        const result = (0, candidate_compare_js_1.comparePlanCandidates)(reference, worker);
        strict_1.default.equal(result.status, "mismatch");
        strict_1.default.ok((result.mismatchedSlotCount ?? 0) >= 1);
        strict_1.default.equal(result.firstMismatchDomain, "forecast");
    });
    (0, node_test_1.it)("does not put large payloads in result", async () => {
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        const a = (0, build_js_1.buildPlanCandidateFromSnapshot)(snapshot).candidate;
        const result = (0, candidate_compare_js_1.comparePlanCandidates)(a, a);
        strict_1.default.ok(!("forecastSlots" in result));
        strict_1.default.ok(!("allocations" in result));
    });
});
