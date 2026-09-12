"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const persist_1 = require("./persist");
(0, node_test_1.describe)("statistics persist retention", () => {
    (0, node_test_1.it)("bounds ordinary daily accounting while preserving a pending invoice", () => {
        const persist = (0, persist_1.emptyPersist)(new Date("2026-09-12T12:00:00.000Z"));
        persist.days["2026-09-12"] = (0, persist_1.emptyDayRecord)("2026-09-12");
        persist.days["2026-09-10"] = (0, persist_1.emptyDayRecord)("2026-09-10");
        persist.days["2026-09-01"] = (0, persist_1.emptyDayRecord)("2026-09-01");
        persist.days["2026-08-31"] = (0, persist_1.emptyDayRecord)("2026-08-31");
        persist.days["2026-08-31"].publicSessions.push({
            id: "open-old",
            openedAtIso: "2026-08-31T10:00:00.000Z",
            closedAtIso: null,
            estimatedKwh: 20,
            invoiceKwh: null,
            invoiceEur: null,
            fuelPriceEurPerLSnapshot: null,
            status: "pending_invoice",
            noteDe: "offen",
        });
        const pruned = (0, persist_1.pruneStatisticsPersist)(persist, "2026-09-12", 3);
        strict_1.default.deepEqual(Object.keys(pruned.days).sort(), ["2026-08-31", "2026-09-10", "2026-09-12"]);
    });
    (0, node_test_1.it)("retains only billing months that can still contribute to retained days", () => {
        const persist = (0, persist_1.emptyPersist)(new Date("2026-09-12T12:00:00.000Z"));
        persist.monthRewardsBilling = {
            "2026-08": { creditEur: 2 },
            "2026-09": { creditEur: 3 },
        };
        const pruned = (0, persist_1.pruneStatisticsPersist)(persist, "2026-09-12", 3);
        strict_1.default.deepEqual(Object.keys(pruned.monthRewardsBilling), ["2026-09"]);
    });
});
