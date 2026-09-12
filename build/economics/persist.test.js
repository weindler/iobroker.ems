"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const persist_1 = require("./persist");
const types_1 = require("./types");
function record(dateKey) {
    return {
        dateKey,
        generatedAtIso: `${dateKey}T23:59:00.000Z`,
        final: true,
        tarifvorteilEur: null,
        emsVorteilEur: null,
        kiMehrwertEur: null,
        gridRewardsCreditEur: null,
        gridRewardsSource: null,
        realNetCostEur: null,
        referenceNoEmsNetCostEur: null,
        emsWithoutAiNetCostEur: null,
        shadowModelVersion: null,
        emsVorteilEvaluable: false,
        kiMehrwertEvaluable: false,
        notesDe: [],
    };
}
(0, node_test_1.describe)("economics persist retention", () => {
    (0, node_test_1.it)("keeps the configured rolling accounting window", () => {
        const persist = (0, types_1.emptyEconomicsPersist)();
        persist.days = {
            "2026-09-09": record("2026-09-09"),
            "2026-09-10": record("2026-09-10"),
            "2026-09-12": record("2026-09-12"),
        };
        const pruned = (0, persist_1.pruneEconomicsPersist)(persist, "2026-09-12", 3);
        strict_1.default.deepEqual(Object.keys(pruned.days).sort(), ["2026-09-10", "2026-09-12"]);
    });
});
