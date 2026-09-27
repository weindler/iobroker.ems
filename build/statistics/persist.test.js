"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const persist_1 = require("./persist");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
(0, node_test_1.describe)("statistics durable writes", () => {
    (0, node_test_1.it)("preserves historical days and recovers the previous complete generation", async () => {
        const dir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "ems-statistics-"));
        try {
            const data = (0, persist_1.emptyPersist)();
            data.days["2000-01-01"] = (0, persist_1.emptyDayRecord)("2000-01-01");
            await (0, persist_1.writeStatisticsPersist)(dir, data);
            data.days["2026-09-27"] = (0, persist_1.emptyDayRecord)("2026-09-27");
            await (0, persist_1.writeStatisticsPersist)(dir, data);
            strict_1.default.equal(Object.keys((await (0, persist_1.readStatisticsPersist)(dir)).days).length, 2);
            await (0, promises_1.writeFile)((0, node_path_1.join)(dir, persist_1.STATISTICS_PERSIST_FILE), "{interrupted");
            const recovered = await (0, persist_1.readStatisticsPersist)(dir);
            strict_1.default.deepEqual(Object.keys(recovered.days), ["2000-01-01"]);
            await (0, persist_1.writeStatisticsPersist)(dir, recovered);
            strict_1.default.deepEqual((await (0, persist_1.readStatisticsPersist)(dir)).days, recovered.days);
        }
        finally {
            await (0, promises_1.rm)(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("does not turn corrupt or future data into an empty archive", async () => {
        const dir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "ems-statistics-"));
        try {
            strict_1.default.deepEqual((await (0, persist_1.readStatisticsPersist)(dir)).days, {});
            const path = (0, node_path_1.join)(dir, persist_1.STATISTICS_PERSIST_FILE);
            await (0, promises_1.writeFile)(path, "broken");
            await strict_1.default.rejects((0, persist_1.readStatisticsPersist)(dir));
            await strict_1.default.rejects((0, persist_1.writeStatisticsPersist)(dir, (0, persist_1.emptyPersist)()));
            await (0, promises_1.writeFile)(path, '{"version":999,"days":{}}');
            await strict_1.default.rejects((0, persist_1.readStatisticsPersist)(dir), /Unsupported/);
            await strict_1.default.rejects((0, persist_1.writeStatisticsPersist)(dir, (0, persist_1.emptyPersist)()), /Unsupported/);
            strict_1.default.equal(await (0, promises_1.readFile)(path, "utf8"), '{"version":999,"days":{}}');
        }
        finally {
            await (0, promises_1.rm)(dir, { recursive: true, force: true });
        }
    });
});
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
