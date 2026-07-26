"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const trigger_digest_js_1 = require("./trigger_digest.js");
function minimalPlan(overrides = {}) {
    return {
        generatedAt: "2026-07-25T10:00:00.000Z",
        validUntil: null,
        revision: 1,
        date: "2026-07-25",
        timezone: "Europe/Berlin",
        slotMinutes: 15,
        globalMode: "balanced",
        status: "ready",
        policySnapshot: {},
        constraintSnapshot: {},
        activeContributionIds: ["pv", "house_load"],
        excludedContributions: [],
        slots: [],
        allocations: [],
        unallocated: [],
        totals: {
            pvForecastEnergyKwh: 30,
            fixedHouseLoadEnergyKwh: 10,
            fixedRenewableBalanceKwh: 20,
            flexibleRequestedEnergyKwh: 5,
            flexibleAllocatedEnergyKwh: 2,
            flexibleUnallocatedEnergyKwh: 3,
            pvAllocatedEnergyKwh: 2,
            gridAllocatedEnergyKwh: 0,
            batteryChargeEnergyKwh: 0,
            wallboxEnergyKwh: 0,
            immersionHeaterEnergyKwh: 2,
            airConditioningEnergyKwh: 0,
            estimatedGridCostCt: 400,
            mandatoryRequestedEnergyKwh: null,
            mandatoryAllocatedEnergyKwh: 0,
            mandatoryUnallocatedEnergyKwh: null,
        },
        quality: { status: "valid", confidencePct: 100, reasonDe: "" },
        reasonDe: "Testplan",
        ...overrides,
    };
}
(0, node_test_1.describe)("aiTriggerDigestPayload", () => {
    (0, node_test_1.it)("is stable when only the revision/slots change (horizon roll, allocation ticks)", () => {
        const a = minimalPlan({ revision: 1, slots: [] });
        const b = minimalPlan({ revision: 42, slots: [] });
        strict_1.default.equal((0, trigger_digest_js_1.aiTriggerDigestPayload)(a), (0, trigger_digest_js_1.aiTriggerDigestPayload)(b));
    });
    (0, node_test_1.it)("is stable for sub-bucket energy noise (< bucket size)", () => {
        const a = minimalPlan({
            totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5.02, pvForecastEnergyKwh: 30.4 },
        });
        const b = minimalPlan({
            totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5.2, pvForecastEnergyKwh: 30.9 },
        });
        strict_1.default.equal((0, trigger_digest_js_1.aiTriggerDigestPayload)(a), (0, trigger_digest_js_1.aiTriggerDigestPayload)(b));
    });
    (0, node_test_1.it)("is stable when only allocation progress changes (assigned/unassigned totals move slot-by-slot)", () => {
        const a = minimalPlan({
            totals: {
                ...minimalPlan().totals,
                flexibleRequestedEnergyKwh: 5,
                flexibleAllocatedEnergyKwh: 0.5,
                flexibleUnallocatedEnergyKwh: 4.5,
            },
        });
        const b = minimalPlan({
            totals: {
                ...minimalPlan().totals,
                flexibleRequestedEnergyKwh: 5,
                flexibleAllocatedEnergyKwh: 2.4,
                flexibleUnallocatedEnergyKwh: 2.6,
            },
        });
        strict_1.default.equal((0, trigger_digest_js_1.aiTriggerDigestPayload)(a), (0, trigger_digest_js_1.aiTriggerDigestPayload)(b));
    });
    (0, node_test_1.it)("is stable when flex demand is repeated across multiple allocation slots (same contribution)", () => {
        const totalsBase = { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 0.494, flexibleAllocatedEnergyKwh: 0.2 };
        const a = minimalPlan({ totals: totalsBase });
        const b = minimalPlan({
            totals: { ...totalsBase, flexibleAllocatedEnergyKwh: 0.49 },
        });
        strict_1.default.equal((0, trigger_digest_js_1.aiTriggerDigestPayload)(a), (0, trigger_digest_js_1.aiTriggerDigestPayload)(b));
    });
    (0, node_test_1.it)("changes when flexibleRequestedEnergyKwh jumps by more than one bucket (e.g. target temp step)", () => {
        const a = minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } });
        const b = minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 6 } });
        strict_1.default.notEqual((0, trigger_digest_js_1.aiTriggerDigestPayload)(a), (0, trigger_digest_js_1.aiTriggerDigestPayload)(b));
    });
    (0, node_test_1.it)("changes when pvForecastEnergyKwh jumps clearly (weather revision)", () => {
        const a = minimalPlan({ totals: { ...minimalPlan().totals, pvForecastEnergyKwh: 30 } });
        const b = minimalPlan({ totals: { ...minimalPlan().totals, pvForecastEnergyKwh: 40 } });
        strict_1.default.notEqual((0, trigger_digest_js_1.aiTriggerDigestPayload)(a), (0, trigger_digest_js_1.aiTriggerDigestPayload)(b));
    });
    (0, node_test_1.it)("changes when an add-on starts or stops contributing", () => {
        const a = minimalPlan({ activeContributionIds: ["pv", "house_load"] });
        const b = minimalPlan({ activeContributionIds: ["pv", "house_load", "immersion_heater.flexible"] });
        strict_1.default.notEqual((0, trigger_digest_js_1.aiTriggerDigestPayload)(a), (0, trigger_digest_js_1.aiTriggerDigestPayload)(b));
    });
    (0, node_test_1.it)("changes on date or global mode change", () => {
        const a = minimalPlan({ date: "2026-07-25" });
        const b = minimalPlan({ date: "2026-07-26" });
        strict_1.default.notEqual((0, trigger_digest_js_1.aiTriggerDigestPayload)(a), (0, trigger_digest_js_1.aiTriggerDigestPayload)(b));
        const c = minimalPlan({ globalMode: "balanced" });
        const d = minimalPlan({ globalMode: "eco" });
        strict_1.default.notEqual((0, trigger_digest_js_1.aiTriggerDigestPayload)(c), (0, trigger_digest_js_1.aiTriggerDigestPayload)(d));
    });
    (0, node_test_1.it)("is order-independent for activeContributionIds/excludedContributions", () => {
        const a = minimalPlan({ activeContributionIds: ["b", "a"] });
        const b = minimalPlan({ activeContributionIds: ["a", "b"] });
        strict_1.default.equal((0, trigger_digest_js_1.aiTriggerDigestPayload)(a), (0, trigger_digest_js_1.aiTriggerDigestPayload)(b));
    });
    (0, node_test_1.it)("handles null totals without throwing", () => {
        const plan = minimalPlan({
            totals: {
                ...minimalPlan().totals,
                flexibleRequestedEnergyKwh: null,
                flexibleUnallocatedEnergyKwh: null,
                pvForecastEnergyKwh: null,
                estimatedGridCostCt: null,
            },
        });
        strict_1.default.doesNotThrow(() => (0, trigger_digest_js_1.aiTriggerDigestPayload)(plan));
    });
});
