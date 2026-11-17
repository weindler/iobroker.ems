import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { writeDayTelemetryDay } from "../day_telemetry/persist";
import { emptyDayRecord } from "../day_telemetry/types";
import { buildDaySlotLayout } from "../day_telemetry/slots";
import { runGridBalanceEconomicsLearning } from "./run";

describe("Netzausgleich-Wirtschaft: Tages-Cache", () => {
	it("abgeschlossene Tage kommen beim zweiten Lauf aus dem Cache, nicht aus den Tagesdateien", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "gbe-cache-"));
		try {
			const telemetryDir = path.join(root, "learning/day_telemetry");
			await fs.mkdir(telemetryDir, { recursive: true });
			for (const key of ["2026-11-01", "2026-11-02", "2026-11-16"]) {
				const layout = buildDaySlotLayout(key, "Europe/Berlin");
				await writeDayTelemetryDay(telemetryDir, emptyDayRecord(key, "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount));
			}
			const host = {
				getAbsolutePath: (category?: string) => path.join(root, category ?? ""),
				setStateAsync: async () => undefined,
			};
			const now = new Date("2026-11-17T12:00:00Z");
			await runGridBalanceEconomicsLearning(host, { now, timezone: "Europe/Berlin" });
			const cacheFile = path.join(root, "learning/grid_balance_economics/days_cache_v1.json");
			const cache = JSON.parse(await fs.readFile(cacheFile, "utf8")) as { days: Record<string, unknown> };
			assert.deepEqual(Object.keys(cache.days).sort(), ["2026-11-01", "2026-11-02"], "nur Tage älter als 2 Tage");
			await fs.writeFile(path.join(telemetryDir, "2026-11-01.json"), "kaputt", "utf8");
			await runGridBalanceEconomicsLearning(host, { now, timezone: "Europe/Berlin" });
			const again = JSON.parse(await fs.readFile(cacheFile, "utf8")) as { days: Record<string, unknown> };
			assert.ok("2026-11-01" in again.days, "defekte Tagesdatei ändert den Cache nicht");
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
