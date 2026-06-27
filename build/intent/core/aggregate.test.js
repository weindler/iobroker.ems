"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const aggregate_js_1 = require("./aggregate.js");
const NOW = new Date("2026-06-27T12:00:00Z");
(0, node_test_1.describe)("resolved all aggregate", () => {
    (0, node_test_1.it)("revision increases on domain semantic change", () => {
        const domainsA = { wallbox: { revision: 1, charge_strategy: { value: "pv" } } };
        const domainsB = { wallbox: { revision: 2, charge_strategy: { value: "off" } } };
        const prev = (0, aggregate_js_1.buildResolvedAllIntent)(null, domainsA, NOW);
        const next = (0, aggregate_js_1.buildResolvedAllIntent)(prev, domainsB, NOW);
        strict_1.default.ok(next.revision > prev.revision);
    });
    (0, node_test_1.it)("revision unchanged for identical domains", () => {
        const domains = { thermal: { revision: 1, operating_request: { value: "auto" } } };
        const prev = (0, aggregate_js_1.buildResolvedAllIntent)(null, domains, NOW);
        const next = (0, aggregate_js_1.buildResolvedAllIntent)(prev, domains, NOW);
        strict_1.default.equal(next.revision, prev.revision);
        strict_1.default.equal(next.resolved_at, prev.resolved_at);
    });
    (0, node_test_1.it)("nextAggregateRevision starts at 1 when domains present", () => {
        strict_1.default.equal((0, aggregate_js_1.nextAggregateRevision)(null, { battery: {} }), 1);
    });
});
