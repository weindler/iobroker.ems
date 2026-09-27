"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const archive_1 = require("./archive");
const persist_1 = require("./persist");
(0, node_test_1.describe)("monthly statistics archive", () => {
    (0, node_test_1.it)("migrates without changing source, preserves billing and baselines, loads months on demand", async () => {
        const dir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "ems-months-"));
        try {
            const seed = (0, persist_1.emptyPersist)(new Date("2026-09-27T10:00:00Z"));
            seed.days["2026-08-11"] = (0, persist_1.emptyDayRecord)("2026-08-11");
            seed.days["2026-09-27"] = (0, persist_1.emptyDayRecord)("2026-09-27");
            seed.monthRewardsBilling["2026-08"] = { creditEur: 2.49 };
            seed.runtime.gridImportEnergyBaselineKwh = 1073.671;
            await (0, persist_1.writeStatisticsPersist)(dir, seed);
            const original = await (0, promises_1.readFile)((0, node_path_1.join)(dir, persist_1.STATISTICS_PERSIST_FILE), "utf8");
            await archive_1.StatisticsArchive.open(dir);
            const archive = await archive_1.StatisticsArchive.open(dir);
            strict_1.default.equal(archive.loadedMonths, 0);
            strict_1.default.equal(Object.keys(archive.data.days).length, 2);
            strict_1.default.equal(archive.loadedMonths, 0);
            strict_1.default.deepEqual(archive.data.days["2026-08-11"], seed.days["2026-08-11"]);
            strict_1.default.equal(archive.loadedMonths, 1);
            strict_1.default.deepEqual(archive.data.runtime, seed.runtime);
            strict_1.default.deepEqual(archive.data.monthRewardsBilling, seed.monthRewardsBilling);
            const filesBefore = await (0, promises_1.readdir)((0, node_path_1.join)(dir, "months"));
            archive.data.days["2026-09-27"].home.gridImportKwh = 5;
            await archive.commit();
            strict_1.default.equal((await (0, promises_1.readdir)((0, node_path_1.join)(dir, "months"))).length, filesBefore.length + 1);
            strict_1.default.equal(await (0, promises_1.readFile)((0, node_path_1.join)(dir, persist_1.STATISTICS_PERSIST_FILE), "utf8"), original);
            strict_1.default.equal(await (0, promises_1.readFile)((0, node_path_1.join)(dir, "statistics_v1.pre-v2.json"), "utf8"), original);
            strict_1.default.equal((await archive_1.StatisticsArchive.open(dir)).data.days["2026-09-27"].home.gridImportKwh, 5);
            strict_1.default.throws(() => { delete archive.data.days["2026-08-11"]; }, /explicit/);
            archive.removeDay("2026-08-11");
            await archive.commit();
            strict_1.default.deepEqual(Object.keys((await archive_1.StatisticsArchive.open(dir)).data.days), ["2026-09-27"]);
        }
        finally {
            await (0, promises_1.rm)(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("refuses damaged or unsupported generations instead of reimporting stale legacy data", async () => {
        const dir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "ems-months-"));
        try {
            const seed = (0, persist_1.emptyPersist)();
            seed.days["2026-09-27"] = (0, persist_1.emptyDayRecord)("2026-09-27");
            await (0, persist_1.writeStatisticsPersist)(dir, seed);
            await archive_1.StatisticsArchive.open(dir);
            const [file] = await (0, promises_1.readdir)((0, node_path_1.join)(dir, "months"));
            await (0, promises_1.writeFile)((0, node_path_1.join)(dir, "months", file), "broken");
            await strict_1.default.rejects(archive_1.StatisticsArchive.open(dir), /checksum/);
            await (0, promises_1.rm)((0, node_path_1.join)(dir, "months", file));
            await strict_1.default.rejects(archive_1.StatisticsArchive.open(dir));
            await (0, promises_1.writeFile)((0, node_path_1.join)(dir, archive_1.STATISTICS_INDEX_FILE), '{"payload":{"version":999}}');
            await strict_1.default.rejects(archive_1.StatisticsArchive.open(dir), /Unsupported/);
        }
        finally {
            await (0, promises_1.rm)(dir, { recursive: true, force: true });
        }
    });
});
