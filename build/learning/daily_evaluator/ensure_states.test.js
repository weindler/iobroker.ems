"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const ensure_states_js_1 = require("./ensure_states.js");
function makeFakeHost() {
    const objects = new Set();
    return {
        objects,
        setObjectNotExistsAsync: async (id) => {
            objects.add(id);
        },
        getStateAsync: async () => null,
        setStateAsync: async () => undefined,
    };
}
(0, node_test_1.describe)("daily_evaluator ensure_states", () => {
    (0, node_test_1.it)("nur minimale, rein lesende Admin-/Visibility-States", () => {
        strict_1.default.equal(ensure_states_js_1.DAILY_EVALUATOR_STATE_IDS.length, 9);
        strict_1.default.ok(ensure_states_js_1.DAILY_EVALUATOR_STATE_IDS.every((id) => id.startsWith("learning.daily_evaluator.")));
    });
    (0, node_test_1.it)("ensureDailyEvaluatorStates legt Channel + alle States ohne Fehler an", async () => {
        const host = makeFakeHost();
        await (0, ensure_states_js_1.ensureDailyEvaluatorStates)(host);
        strict_1.default.ok(host.objects.has("learning.daily_evaluator"));
        for (const id of ensure_states_js_1.DAILY_EVALUATOR_STATE_IDS) {
            strict_1.default.ok(host.objects.has(id), `state ${id} wurde nicht angelegt`);
        }
    });
});
