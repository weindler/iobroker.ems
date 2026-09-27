import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDayRecord, emptyPersist, pruneStatisticsPersist, readStatisticsPersist, writeStatisticsPersist, STATISTICS_PERSIST_FILE } from "./persist";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("statistics durable writes", () => {
	it("preserves historical days and recovers the previous complete generation", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ems-statistics-"));
		try {
			const data = emptyPersist();
			data.days["2000-01-01"] = emptyDayRecord("2000-01-01");
			await writeStatisticsPersist(dir, data);
			data.days["2026-09-27"] = emptyDayRecord("2026-09-27");
			await writeStatisticsPersist(dir, data);
			assert.equal(Object.keys((await readStatisticsPersist(dir)).days).length, 2);
			await writeFile(join(dir, STATISTICS_PERSIST_FILE), "{interrupted");
			const recovered = await readStatisticsPersist(dir);
			assert.deepEqual(Object.keys(recovered.days), ["2000-01-01"]);
			await writeStatisticsPersist(dir, recovered);
			assert.deepEqual((await readStatisticsPersist(dir)).days, recovered.days);
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
	it("does not turn corrupt or future data into an empty archive", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ems-statistics-"));
		try {
			assert.deepEqual((await readStatisticsPersist(dir)).days, {});
			const path = join(dir, STATISTICS_PERSIST_FILE);
			await writeFile(path, "broken");
			await assert.rejects(readStatisticsPersist(dir));
			await assert.rejects(writeStatisticsPersist(dir, emptyPersist()));
			await writeFile(path, '{"version":999,"days":{}}');
			await assert.rejects(readStatisticsPersist(dir), /Unsupported/);
			await assert.rejects(writeStatisticsPersist(dir, emptyPersist()), /Unsupported/);
			assert.equal(await readFile(path, "utf8"), '{"version":999,"days":{}}');
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
});

describe("statistics persist retention", () => {
	it("bounds ordinary daily accounting while preserving a pending invoice", () => {
		const persist = emptyPersist(new Date("2026-09-12T12:00:00.000Z"));
		persist.days["2026-09-12"] = emptyDayRecord("2026-09-12");
		persist.days["2026-09-10"] = emptyDayRecord("2026-09-10");
		persist.days["2026-09-01"] = emptyDayRecord("2026-09-01");
		persist.days["2026-08-31"] = emptyDayRecord("2026-08-31");
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

		const pruned = pruneStatisticsPersist(persist, "2026-09-12", 3);
		assert.deepEqual(Object.keys(pruned.days).sort(), ["2026-08-31", "2026-09-10", "2026-09-12"]);
	});

	it("retains only billing months that can still contribute to retained days", () => {
		const persist = emptyPersist(new Date("2026-09-12T12:00:00.000Z"));
		persist.monthRewardsBilling = {
			"2026-08": { creditEur: 2 },
			"2026-09": { creditEur: 3 },
		};
		const pruned = pruneStatisticsPersist(persist, "2026-09-12", 3);
		assert.deepEqual(Object.keys(pruned.monthRewardsBilling), ["2026-09"]);
	});
});
