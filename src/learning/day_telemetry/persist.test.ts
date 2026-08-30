import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { addDaysToDateKey } from "../../operator/time.js";
import { DAY_TELEMETRY_RETENTION_DAYS, DAY_TELEMETRY_STATE_IDS } from "./index.js";
import {
	dayTelemetryPersistPath,
	pruneDayTelemetryStore,
	readDayTelemetryPersist,
	writeDayTelemetryPersist,
} from "./persist.js";
import { buildDaySlotLayout } from "./slots.js";
import { emptyDayRecord, emptyDayTelemetryStore } from "./types.js";

describe("day_telemetry persist retention", () => {
	it("14/15) 90 Tage Retention — Tag 91 löscht ältesten", () => {
		let store = emptyDayTelemetryStore();
		const start = "2026-01-01";
		for (let i = 0; i < 91; i++) {
			const dk = addDaysToDateKey(start, i);
			const layout = buildDaySlotLayout(dk, "Europe/Berlin");
			store.days[dk] = emptyDayRecord(
				dk,
				"Europe/Berlin",
				layout.startMs,
				layout.endMs,
				layout.slotCount,
			);
		}
		assert.equal(Object.keys(store.days).length, 91);
		const today = addDaysToDateKey(start, 90);
		store = pruneDayTelemetryStore(store, DAY_TELEMETRY_RETENTION_DAYS, today);
		const keys = Object.keys(store.days).sort();
		assert.equal(keys.length, 90);
		assert.equal(keys[0], addDaysToDateKey(start, 1));
		assert.equal(keys[keys.length - 1], today);
		assert.equal(store.days[start], undefined);
	});

	it("18) nur minimale neue States", () => {
		assert.equal(DAY_TELEMETRY_STATE_IDS.length, 3);
		assert.ok(DAY_TELEMETRY_STATE_IDS.every((id) => id.startsWith("learning.day_telemetry.")));
	});

	it("atomic write roundtrip", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daytel-"));
		try {
			const store = emptyDayTelemetryStore();
			const layout = buildDaySlotLayout("2026-06-15", "Europe/Berlin");
			store.days["2026-06-15"] = emptyDayRecord(
				"2026-06-15",
				"Europe/Berlin",
				layout.startMs,
				layout.endMs,
				layout.slotCount,
			);
			await writeDayTelemetryPersist(dir, store);
			const loaded = await readDayTelemetryPersist(dir);
			assert.ok(loaded);
			assert.equal(loaded!.days["2026-06-15"].slotCount, 96);
			const dayFile = path.join(dir, "2026-06-15.json");
			const st = await fs.stat(dayFile);
			assert.ok(st.size > 100);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
