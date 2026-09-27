import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, rm, readFile, readdir, writeFile, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StatisticsArchive, STATISTICS_INDEX_FILE, openStatisticsArchive, commitStatisticsArchive, exportStatisticsArchive } from "./archive";
import { applyStatisticsAdjust } from "./adjust";
import { emptyPersist, emptyDayRecord, writeStatisticsPersist, STATISTICS_PERSIST_FILE } from "./persist";

describe("monthly statistics archive", () => {
	it("recovers a damaged index with matching month files and runtime baselines", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ems-recovery-"));
		try {
			const seed = emptyPersist(); seed.days["2026-09-27"] = emptyDayRecord("2026-09-27");
			seed.runtime.gridImportEnergyBaselineKwh = 100;
			await writeStatisticsPersist(dir, seed);
			const archive = await openStatisticsArchive(dir);
			archive.runtime.gridImportEnergyBaselineKwh = 101;
			archive.days["2026-09-27"].home.gridImportKwh = 1;
			await commitStatisticsArchive(archive);
			await writeFile(join(dir, STATISTICS_INDEX_FILE), "interrupted");
			const recovered = await openStatisticsArchive(dir);
			assert.equal(recovered.archiveRecovery, true);
			assert.equal(recovered.runtime.gridImportEnergyBaselineKwh, 100);
			assert.equal(recovered.days["2026-09-27"].home.gridImportKwh, null);
			await commitStatisticsArchive(recovered);
			assert.equal((await openStatisticsArchive(dir)).runtime.gridImportEnergyBaselineKwh, 100);
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
	it("restores a full directory backup and preserves archive attachment through explicit reset", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ems-backup-months-"));
		try {
			const original = join(dir, "original"), backup = join(dir, "backup");
			const seed = emptyPersist(new Date("2026-09-27T10:00:00Z"));
			seed.days["2026-08-11"] = emptyDayRecord("2026-08-11");
			seed.days["2026-08-11"].mobility.homeGridKwh = 12.34;
			seed.monthRewardsBilling["2026-08"] = { creditEur: 2.49 };
			await writeStatisticsPersist(original, seed);
			await openStatisticsArchive(original);
			await cp(original, backup, { recursive: true });
			const restored = await openStatisticsArchive(backup);
			assert.deepEqual(restored.days["2026-08-11"], seed.days["2026-08-11"]);
			assert.deepEqual(restored.monthRewardsBilling, seed.monthRewardsBilling);
			const exportData = await exportStatisticsArchive(backup, 2 * 1024 * 1024);
			assert.deepEqual(exportData?.days, seed.days);
			applyStatisticsAdjust(restored, { resetAll: true }, new Date("2026-09-27T10:00:00Z"));
			await commitStatisticsArchive(restored);
			assert.equal(Object.keys((await openStatisticsArchive(backup)).days).length, 0);
			assert.equal(Object.keys((await openStatisticsArchive(original)).days).length, 1);
			await writeFile(join(backup, "statistics_restore_v1.json"), JSON.stringify(exportData));
			assert.deepEqual((await openStatisticsArchive(backup)).days["2026-08-11"], seed.days["2026-08-11"]);
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
	it("migrates without changing source, preserves billing and baselines, loads months on demand", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ems-months-"));
		try {
			const seed = emptyPersist(new Date("2026-09-27T10:00:00Z"));
			seed.days["2026-08-11"] = emptyDayRecord("2026-08-11");
			seed.days["2026-09-27"] = emptyDayRecord("2026-09-27");
			seed.monthRewardsBilling["2026-08"] = { creditEur: 2.49 };
			seed.runtime.gridImportEnergyBaselineKwh = 1073.671;
			await writeStatisticsPersist(dir, seed);
			const original = await readFile(join(dir, STATISTICS_PERSIST_FILE), "utf8");
			await StatisticsArchive.open(dir);
			const archive = await StatisticsArchive.open(dir);
			assert.equal(archive.loadedMonths, 0);
			assert.equal(Object.keys(archive.data.days).length, 2);
			assert.equal(archive.loadedMonths, 0);
			assert.deepEqual(archive.data.days["2026-08-11"], seed.days["2026-08-11"]);
			assert.equal(archive.loadedMonths, 1);
			assert.deepEqual(archive.data.runtime, seed.runtime);
			assert.deepEqual(archive.data.monthRewardsBilling, seed.monthRewardsBilling);
			const filesBefore = await readdir(join(dir, "months"));
			archive.data.days["2026-09-27"].home.gridImportKwh = 5;
			await archive.commit();
			assert.equal((await readdir(join(dir, "months"))).length, filesBefore.length + 1);
			assert.equal(await readFile(join(dir, STATISTICS_PERSIST_FILE), "utf8"), original);
			assert.equal(await readFile(join(dir, "statistics_v1.pre-v2.json"), "utf8"), original);
			assert.equal((await StatisticsArchive.open(dir)).data.days["2026-09-27"].home.gridImportKwh, 5);
			assert.throws(() => { delete archive.data.days["2026-08-11"]; }, /explicit/);
			archive.removeDay("2026-08-11");
			await archive.commit();
			assert.deepEqual(Object.keys((await StatisticsArchive.open(dir)).data.days), ["2026-09-27"]);
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
	it("refuses damaged or unsupported generations instead of reimporting stale legacy data", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ems-months-"));
		try {
			const seed = emptyPersist();
			seed.days["2026-09-27"] = emptyDayRecord("2026-09-27");
			await writeStatisticsPersist(dir, seed);
			await StatisticsArchive.open(dir);
			const [file] = await readdir(join(dir, "months"));
			await writeFile(join(dir, "months", file), "broken");
			await assert.rejects(StatisticsArchive.open(dir), /checksum/);
			await rm(join(dir, "months", file));
			await assert.rejects(StatisticsArchive.open(dir));
			await writeFile(join(dir, STATISTICS_INDEX_FILE), '{"payload":{"version":999}}');
			await assert.rejects(StatisticsArchive.open(dir), /Unsupported/);
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
});
