"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const test_helpers_js_1 = require("./test_helpers.js");
const knowledge_time_js_1 = require("./knowledge_time.js");
(0, node_test_1.describe)("daily_evaluator knowledge_time", () => {
    (0, node_test_1.it)("resolveKnowledgeSnapshotAt: wählt letzten Snapshot <= Zeitpunkt, nie später", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        const s1 = (0, test_helpers_js_1.makeSnapshot)({ id: "s1", tsIso: "2026-06-15T08:00:00.000Z" });
        const s2 = (0, test_helpers_js_1.makeSnapshot)({ id: "s2", tsIso: "2026-06-15T12:00:00.000Z" });
        const s3 = (0, test_helpers_js_1.makeSnapshot)({ id: "s3", tsIso: "2026-06-15T18:00:00.000Z" });
        day.forecastSnapshots.push(s1, s2, s3);
        const at10 = (0, knowledge_time_js_1.resolveKnowledgeSnapshotAt)(day, Date.parse("2026-06-15T10:00:00.000Z"));
        strict_1.default.equal(at10?.id, "s1");
        const at15 = (0, knowledge_time_js_1.resolveKnowledgeSnapshotAt)(day, Date.parse("2026-06-15T15:00:00.000Z"));
        strict_1.default.equal(at15?.id, "s2");
        const before = (0, knowledge_time_js_1.resolveKnowledgeSnapshotAt)(day, Date.parse("2026-06-15T00:00:00.000Z"));
        strict_1.default.equal(before, null);
    });
    (0, node_test_1.it)("resolveKnownPriceAtSlotStart: exaktes Slot-Start-Match, kein Interpolieren", () => {
        const snap = (0, test_helpers_js_1.makeSnapshot)({
            priceSlots: [
                [Date.parse("2026-06-15T12:00:00.000Z"), 20],
                [Date.parse("2026-06-15T12:15:00.000Z"), 25],
            ],
        });
        strict_1.default.equal((0, knowledge_time_js_1.resolveKnownPriceAtSlotStart)(snap, Date.parse("2026-06-15T12:00:00.000Z")), 20);
        strict_1.default.equal((0, knowledge_time_js_1.resolveKnownPriceAtSlotStart)(snap, Date.parse("2026-06-15T12:07:00.000Z")), null);
        strict_1.default.equal((0, knowledge_time_js_1.resolveKnownPriceAtSlotStart)(null, Date.parse("2026-06-15T12:00:00.000Z")), null);
    });
    (0, node_test_1.it)("priceRankPercentileAtDecisionTime: 0 = günstigstes, 1 exklusiv teuerstes bekanntes Fenster", () => {
        const snap = (0, test_helpers_js_1.makeSnapshot)({
            priceSlots: [10, 20, 30, 40, 50].map((ct, i) => [Date.parse("2026-06-15T00:00:00.000Z") + i * 900_000, ct]),
        });
        strict_1.default.equal((0, knowledge_time_js_1.priceRankPercentileAtDecisionTime)(snap, 10), 0);
        strict_1.default.equal((0, knowledge_time_js_1.priceRankPercentileAtDecisionTime)(snap, 50), 0.8);
        strict_1.default.equal((0, knowledge_time_js_1.priceRankPercentileAtDecisionTime)(snap, null), null);
    });
    (0, node_test_1.it)("priceRankPercentileAtDecisionTime: < 4 Slots → null (zu kurze Reihe)", () => {
        const snap = (0, test_helpers_js_1.makeSnapshot)({
            priceSlots: [
                [1, 10],
                [2, 20],
            ],
        });
        strict_1.default.equal((0, knowledge_time_js_1.priceRankPercentileAtDecisionTime)(snap, 15), null);
    });
});
