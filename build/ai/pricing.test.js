"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const pricing_js_1 = require("./pricing.js");
(0, node_test_1.describe)("ai pricing", () => {
    (0, node_test_1.it)("zero tokens → zero cost", () => {
        strict_1.default.equal((0, pricing_js_1.estimateCostEur)("gpt-4.1-mini", 0, 0), 0);
        strict_1.default.equal((0, pricing_js_1.estimateCostEur)("gpt-4.1-mini", null, null), 0);
    });
    (0, node_test_1.it)("more output tokens cost more than the same input tokens (output is pricier)", () => {
        const inputOnly = (0, pricing_js_1.estimateCostEur)("gpt-4.1-mini", 1000, 0);
        const outputOnly = (0, pricing_js_1.estimateCostEur)("gpt-4.1-mini", 0, 1000);
        strict_1.default.ok(outputOnly > inputOnly);
    });
    (0, node_test_1.it)("cheap model (gpt-4o-mini) costs less than a pricier model for the same tokens", () => {
        const cheap = (0, pricing_js_1.estimateCostEur)("gpt-4o-mini", 10_000, 2_000);
        const pricier = (0, pricing_js_1.estimateCostEur)("gpt-4.1", 10_000, 2_000);
        strict_1.default.ok(cheap < pricier);
    });
    (0, node_test_1.it)("char-count estimate returns a positive, finite number for a normal prompt", () => {
        const cost = (0, pricing_js_1.estimateCostEurFromCharCount)("gpt-4.1-mini", 2000);
        strict_1.default.ok(Number.isFinite(cost));
        strict_1.default.ok(cost > 0);
    });
});
