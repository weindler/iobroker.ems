import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { emptyDayRecord } from "../day_telemetry/types";
import { buildDaySlotLayout } from "../day_telemetry/slots";
import { writeDayTelemetryDay } from "../day_telemetry/persist";
import { DAY_TELEMETRY_CATEGORY } from "../day_telemetry/constants";
import { thermalTestSegment } from "./math";
import { runClimateThermalLearning, type ClimateThermalHost } from "./run";
import { readClimateThermalPersist } from "./persist";
import { CLIMATE_THERMAL_FILENAME } from "./types";

class FakeHost implements ClimateThermalHost {
	dir: string;
	config: Record<string, unknown> = {
		timezone: "Europe/Berlin",
		ac_u1_enabled: true,
		ac_u1_mode_when_cooling: "cool",
		ac_u1_mode_when_heating: "",
		ac_u2_enabled: false,
	};
	states = new Map<string, ioBroker.StateValue>();
	log = { warn: () => undefined, debug: () => undefined, error: () => undefined };

	constructor(dir: string) {
		this.dir = dir;
	}

	getAbsolutePath = (category?: string) => path.join(this.dir, category ?? "");
	getStateAsync = async () => null;
	setStateAsync = async (id: string, state: ioBroker.SettableState) => {
		this.states.set(id, state.val as ioBroker.StateValue);
		return null;
	};
	setObjectNotExistsAsync = async () => undefined;
	extendObjectAsync = async () => undefined;
}

describe("climate thermal persist / restart", () => {
	it("schreibt Persistenz, überlebt Restart und setzt Heating auf unavailable", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ct-run-"));
		try {
			const host = new FakeHost(dir);
			const telDir = host.getAbsolutePath(DAY_TELEMETRY_CATEGORY);
			const layout = buildDaySlotLayout("2026-08-01", "Europe/Berlin");
			const day = emptyDayRecord("2026-08-01", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
			day.climateRunSegments = [
				thermalTestSegment({
					startTs: layout.startMs + 10 * 3600_000,
					endTs: layout.startMs + 10 * 3600_000 + 1800_000,
					runtimeSec: 1800,
				}),
			];
			await writeDayTelemetryDay(telDir, day);

			const first = await runClimateThermalLearning(host, { now: new Date("2026-08-02T08:00:00Z") });
			assert.ok(first.units["1"]);
			assert.equal(first.units["1"].heating.status, "unavailable");
			assert.equal(first.units["1"].heating.rate, null);
			assert.ok(first.units["1"].cooling.sampleCount >= 1);
			assert.equal(first.units["1"].cooling.usable, false);

			const persistPath = path.join(host.getAbsolutePath("learning/climate_thermal"), CLIMATE_THERMAL_FILENAME);
			const raw = await fs.readFile(persistPath, "utf8");
			assert.ok(raw.includes("climate_thermal") || raw.includes('"version": 1'));

			const host2 = new FakeHost(dir);
			host2.config = host.config;
			const second = await runClimateThermalLearning(host2, { now: new Date("2026-08-02T09:00:00Z") });
			assert.equal(second.units["1"].cooling.sampleCount, first.units["1"].cooling.sampleCount);
			assert.equal(second.units["1"].heating.status, "unavailable");

			const reloaded = await readClimateThermalPersist(host2.getAbsolutePath("learning/climate_thermal"));
			assert.equal(reloaded.units["1"].heating.status, "unavailable");
			assert.equal(host2.states.get("learning.climate_thermal.unit_1.heating_usable"), false);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
