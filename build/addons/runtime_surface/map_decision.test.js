"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const index_js_1 = require("./index.js");
const registry_js_1 = require("../governance/registry.js");
function mockHost(initial = {}) {
    const objects = new Set();
    const states = new Map(Object.entries(initial));
    return {
        objects,
        states,
        host: {
            setObjectNotExistsAsync: async (id) => {
                objects.add(id);
            },
            getStateAsync: async (id) => states.get(id) ?? null,
            setStateAsync: async (id, st) => {
                states.set(id, { val: st.val, ack: st.ack === true });
            },
        },
    };
}
(0, node_test_1.describe)("runtime_surface mapDecisionDetailToCanonical", () => {
    (0, node_test_1.it)("maps daily_plan family to deterministic_planner", () => {
        strict_1.default.equal((0, index_js_1.mapDecisionDetailToCanonical)("daily_plan"), "deterministic_planner");
        strict_1.default.equal((0, index_js_1.mapDecisionDetailToCanonical)("daily_plan_zero"), "deterministic_planner");
        strict_1.default.equal((0, index_js_1.mapDecisionDetailToCanonical)("daily_plan_passive_pv"), "deterministic_planner");
        strict_1.default.equal((0, index_js_1.mapDecisionDetailToCanonical)("surplus_pull_forward"), "deterministic_planner");
    });
    (0, node_test_1.it)("maps off / manual / fallbacks / safety", () => {
        strict_1.default.equal((0, index_js_1.mapDecisionDetailToCanonical)("governance_disabled"), "off");
        strict_1.default.equal((0, index_js_1.mapDecisionDetailToCanonical)("manual_force"), "manual");
        strict_1.default.equal((0, index_js_1.mapDecisionDetailToCanonical)("thermal_fallback"), "policy_fallback");
        strict_1.default.equal((0, index_js_1.mapDecisionDetailToCanonical)("climate_fallback"), "policy_fallback");
        strict_1.default.equal((0, index_js_1.mapDecisionDetailToCanonical)("fault"), "safety");
        strict_1.default.equal((0, index_js_1.mapDecisionDetailToCanonical)("missing_telemetry"), "safety");
        strict_1.default.equal((0, index_js_1.mapDecisionDetailToCanonical)("ai"), "ai");
    });
    (0, node_test_1.it)("unknown detail → safety (no fake planner)", () => {
        strict_1.default.equal((0, index_js_1.mapDecisionDetailToCanonical)("something_weird"), "safety");
        strict_1.default.equal((0, index_js_1.mapDecisionDetailToCanonical)(""), "safety");
    });
});
(0, node_test_1.describe)("runtime_surface plannerStatusFromDailyPlan", () => {
    (0, node_test_1.it)("off when governance or addon disabled", () => {
        strict_1.default.equal((0, index_js_1.plannerStatusFromDailyPlan)({ governanceEnabled: false, dailyPlanStatus: "valid" }), "off");
        strict_1.default.equal((0, index_js_1.plannerStatusFromDailyPlan)({
            governanceEnabled: true,
            addonEnabled: false,
            useDailyPlan: true,
        }), "off");
    });
    (0, node_test_1.it)("valid when useDailyPlan", () => {
        strict_1.default.equal((0, index_js_1.plannerStatusFromDailyPlan)({
            governanceEnabled: true,
            useDailyPlan: true,
            dailyPlanStatus: "daily_plan_missing",
        }), "valid");
    });
    (0, node_test_1.it)("missing / invalid from status string", () => {
        strict_1.default.equal((0, index_js_1.plannerStatusFromDailyPlan)({
            governanceEnabled: true,
            dailyPlanStatus: "daily_plan_missing",
        }), "missing");
        strict_1.default.equal((0, index_js_1.plannerStatusFromDailyPlan)({
            governanceEnabled: true,
            dailyPlanStatus: "invalid_plan",
        }), "invalid");
    });
});
(0, node_test_1.describe)("runtime_surface ensure + publish", () => {
    (0, node_test_1.it)("ensures surface states for all governed runtime ids", async () => {
        const mock = mockHost();
        await (0, index_js_1.ensureAddonRuntimeSurfaceStates)(mock.host);
        for (const entry of registry_js_1.GOVERNED_ADDON_REGISTRY) {
            const ids = (0, index_js_1.runtimeSurfaceStateMap)(entry.runtimeAddonId);
            strict_1.default.ok(mock.objects.has(ids.decisionSource), entry.runtimeAddonId);
            strict_1.default.ok(mock.objects.has(ids.plannerStatus), entry.runtimeAddonId);
            strict_1.default.ok(mock.objects.has(ids.fault), entry.runtimeAddonId);
        }
        strict_1.default.ok(mock.objects.has("addons.air_conditioning.runtime.surface.decision_source"));
    });
    (0, node_test_1.it)("publishes canonical surface and only writes on change", async () => {
        const mock = mockHost();
        await (0, index_js_1.ensureAddonRuntimeSurfaceStates)(mock.host);
        let writes = 0;
        const countingHost = {
            ...mock.host,
            setStateAsync: async (id, st) => {
                writes++;
                return mock.host.setStateAsync(id, st);
            },
        };
        const input = {
            decisionDetail: "daily_plan",
            decisionReason: "Slot aktiv",
            nowIso: "2026-07-27T12:00:00.000Z",
            plannerStatus: "valid",
            intentStatus: "active",
            executionStatus: "dryrun",
            profileReady: true,
            telemetryReady: true,
            fault: false,
            lockout: false,
        };
        const snap = await (0, index_js_1.publishAddonRuntimeSurface)(countingHost, "immersion_heater", input);
        strict_1.default.equal(snap.decisionSource, "deterministic_planner");
        strict_1.default.equal(snap.decisionDetail, "daily_plan");
        const ids = (0, index_js_1.runtimeSurfaceStateMap)("immersion_heater");
        strict_1.default.equal(mock.states.get(ids.decisionSource)?.val, "deterministic_planner");
        strict_1.default.equal(mock.states.get(ids.decisionDetail)?.val, "daily_plan");
        strict_1.default.equal(mock.states.get(ids.plannerStatus)?.val, "valid");
        strict_1.default.equal(mock.states.get(ids.lastDecisionAt)?.val, "2026-07-27T12:00:00.000Z");
        const firstWrites = writes;
        strict_1.default.ok(firstWrites >= 11);
        writes = 0;
        await (0, index_js_1.publishAddonRuntimeSurface)(countingHost, "immersion_heater", input);
        strict_1.default.equal(writes, 0);
        const built = (0, index_js_1.buildAddonRuntimeSurfaceSnapshot)({
            ...input,
            decisionDetail: "manual_off",
        });
        strict_1.default.equal(built.decisionSource, "manual");
    });
});
