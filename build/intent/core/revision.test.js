"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const revision_js_1 = require("./revision.js");
const types_js_1 = require("../wallbox/types.js");
function baseIntent(now) {
    const i = (0, types_js_1.emptyResolvedWallboxIntent)(now);
    i.charge_strategy = {
        value: "pv",
        status: "valid",
        origin: { source: "evcc", owner: "evcc", change_kind: "unknown" },
        observed_at: now.toISOString(),
    };
    i.intent_state = "available";
    i.revision = 1;
    return i;
}
(0, node_test_1.describe)("intent revision", () => {
    (0, node_test_1.it)("same semantic hash for identical intents", () => {
        const now = new Date("2026-06-27T10:00:00Z");
        const a = baseIntent(now);
        const b = baseIntent(now);
        b.resolved_at = "2026-06-27T11:00:00Z";
        strict_1.default.equal((0, revision_js_1.computeSemanticHash)(a), (0, revision_js_1.computeSemanticHash)(b));
    });
    (0, node_test_1.it)("observed_at change alone does not change semantic hash", () => {
        const now = new Date("2026-06-27T10:00:00Z");
        const a = baseIntent(now);
        const b = { ...baseIntent(now), charge_strategy: { ...a.charge_strategy, observed_at: "2026-06-28T00:00:00Z" } };
        strict_1.default.equal((0, revision_js_1.semanticIntentChanged)(a, b), false);
    });
    (0, node_test_1.it)("external plan observed_at change alone does not bump revision (no per-poll flapping)", () => {
        const now = new Date("2026-06-27T10:00:00Z");
        const prev = baseIntent(now);
        const next = baseIntent(now);
        next.external_planner_plan = {
            ...next.external_planner_plan,
            observed_at: "2026-06-28T08:00:00Z",
        };
        strict_1.default.equal((0, revision_js_1.semanticIntentChanged)(prev, next), false);
        strict_1.default.equal((0, revision_js_1.nextRevision)(prev, next), prev.revision);
    });
    (0, node_test_1.it)("value change bumps revision", () => {
        const now = new Date("2026-06-27T10:00:00Z");
        const prev = baseIntent(now);
        const next = baseIntent(now);
        next.charge_strategy = { ...next.charge_strategy, value: "immediate" };
        strict_1.default.equal((0, revision_js_1.nextRevision)(prev, next), 2);
    });
    (0, node_test_1.it)("identical restart keeps revision", () => {
        const now = new Date("2026-06-27T10:00:00Z");
        const prev = baseIntent(now);
        const next = baseIntent(now);
        strict_1.default.equal((0, revision_js_1.nextRevision)(prev, next), prev.revision);
    });
});
