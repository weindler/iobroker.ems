"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const authoritative_source_js_1 = require("./authoritative_source.js");
(0, node_test_1.describe)("planner_config authoritative source", () => {
    (0, node_test_1.it)("defaults to legacy", () => {
        strict_1.default.equal(authoritative_source_js_1.PLANNER_AUTHORITATIVE_SOURCE_DEFAULT, "legacy");
        strict_1.default.equal((0, authoritative_source_js_1.parsePlannerRequestedAuthority)(undefined).mode, "legacy");
    });
    (0, node_test_1.it)("clamps invalid values", () => {
        const p = (0, authoritative_source_js_1.parsePlannerRequestedAuthority)("worker_live");
        strict_1.default.equal(p.mode, "legacy");
        strict_1.default.equal(p.clamped, true);
    });
    (0, node_test_1.it)("accepts worker_dryrun without auto-activate semantics", () => {
        strict_1.default.equal((0, authoritative_source_js_1.plannerRequestedAuthorityFromConfig)({
            planner_authoritative_source: "worker_dryrun",
        }).mode, "worker_dryrun");
    });
});
