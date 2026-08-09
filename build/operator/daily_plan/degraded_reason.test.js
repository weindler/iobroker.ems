"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const degraded_reason_1 = require("./degraded_reason");
const contribution_ids_1 = require("../contribution_ids");
const quality_1 = require("../quality");
const types_1 = require("../contributions/types");
const contributor_1 = require("../contributor");
function ihFlex(details, status = "degraded") {
    return (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, (0, contributor_1.addonContributorRef)("immersion_heater"), "consume", ["supply"], {
        generatedAt: "2026-08-09T10:00:00.000Z",
        validUntil: null,
        revision: 1,
        enabled: true,
        flexible: true,
        gridEligible: false,
        quality: (0, quality_1.operatorQuality)(status, "t", 60),
        reasonDe: "t",
        details,
        slots: [],
    });
}
(0, node_test_1.describe)("D1 daily plan degraded reason", () => {
    (0, node_test_1.it)("names Newton-only thermal learning cause exactly", () => {
        const cause = (0, degraded_reason_1.explainDailyPlanDegradedDe)([
            ihFlex({
                thermalLearningStatus: "degraded",
                thermalLearningModel: "newton",
                thermalLearningSamples: 0,
                thermalLearningDegradedCauseDe: "thermal learning usable only via Newton estimate, 0 completed cooling cycles",
            }),
        ], { hasDegradedContributions: true });
        strict_1.default.equal(cause, "thermal learning usable only via Newton estimate, 0 completed cooling cycles");
    });
    (0, node_test_1.it)("falls back from thermalLearningModel when cause string missing", () => {
        const cause = (0, degraded_reason_1.explainDailyPlanDegradedDe)([
            ihFlex({
                thermalLearningStatus: "degraded",
                thermalLearningModel: "newton",
                thermalLearningSamples: 0,
            }),
        ], {});
        strict_1.default.match(cause, /Newton estimate.*0 completed cooling cycles/);
    });
});
