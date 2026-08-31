import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { BAT } from "../../addons/battery/ensure_states";
import { DAY_TELEMETRY_SLOT_MS } from "../day_telemetry/constants";
import { __resetDayTelemetryRuntimeForTest, tickDayTelemetry, type DayTelemetryHost } from "../day_telemetry/record";
import { readDayTelemetryDay, writeDayTelemetryDay } from "../day_telemetry/persist";
import { emptyDayRecord } from "../day_telemetry/types";
import { buildDaySlotLayout } from "../day_telemetry/slots";
import { computeNightDischarges } from "./math";
import type { PowerPoint, SocPoint } from "./types";
import {
	gridBalanceKwhSlotToPowerW,
	loadGridBalancePowerFromDayTelemetry,
	powerPointsFromGridBalanceDay,
} from "./grid_balance_from_telemetry";

class FakeTelHost implements DayTelemetryHost {
	states = new Map<string, ioBroker.StateValue>();
	dir: string;
	config: Record<string, unknown> = { timezone: "Europe/Berlin" };
	log = { warn: () => undefined, debug: () => undefined, error: () => undefined };

	constructor(dir: string) {
		this.dir = dir;
	}

	getAbsolutePath = (category?: string) => path.join(this.dir, category ?? "");
	getStateAsync = async (id: string) => {
		if (!this.states.has(id)) return null;
		return { val: this.states.get(id), ack: true } as ioBroker.State;
	};
	getForeignStateAsync = async (id: string) => this.getStateAsync(id);
	setStateAsync = async (id: string, state: ioBroker.SettableState) => {
		this.states.set(id, state.val as ioBroker.StateValue);
		return null;
	};
	set(id: string, val: ioBroker.StateValue): void {
		this.states.set(id, val);
	}
}

describe("grid balance from day telemetry", () => {
	it("rekonstruiert energieerhaltende Leistung aus Slot-kWh (inkl. gemessener 0)", () => {
		const layout = buildDaySlotLayout("2026-08-30", "Europe/Berlin");
		const day = emptyDayRecord("2026-08-30", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
		day.buckets.gridBalanceDischargeKwh[0] = 0.5;
		day.buckets.gridBalanceDischargeKwh[1] = 0;
		const points = powerPointsFromGridBalanceDay(day);
		assert.equal(points.length, 2);
		assert.equal(points[0]!.powerW, gridBalanceKwhSlotToPowerW(0.5, DAY_TELEMETRY_SLOT_MS));
		assert.equal(points[1]!.powerW, 0);
		const hours = DAY_TELEMETRY_SLOT_MS / 3_600_000;
		assert.ok(Math.abs((points[0]!.powerW * hours) / 1000 - 0.5) < 1e-9);
	});

	it("alte Tagesdatei ohne GB-Bucket liefert keine Punkte und erfindet keine 0", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gb-tele-"));
		try {
			const layout = buildDaySlotLayout("2026-08-20", "Europe/Berlin");
			const day = emptyDayRecord("2026-08-20", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
			delete (day.buckets as { gridBalanceDischargeKwh?: unknown }).gridBalanceDischargeKwh;
			await writeDayTelemetryDay(dir, day);
			const loaded = await loadGridBalancePowerFromDayTelemetry(
				dir,
				90,
				new Date("2026-08-30T12:00:00+02:00"),
				"Europe/Berlin",
			);
			assert.equal(loaded.observedDayCount, 0);
			assert.equal(loaded.points.length, 0);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("Tick schreibt GB-Leistung in Day-Telemetry; SOC minus gemessene GB-kWh", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gb-tick-"));
		__resetDayTelemetryRuntimeForTest();
		try {
			const host = new FakeTelHost(dir);
			host.set(BAT.gridBalance.effectivePowerW, 400);
			const t0 = new Date("2026-08-30T22:00:00+02:00");
			await tickDayTelemetry(host, t0);
			const t1 = new Date("2026-08-30T22:01:00+02:00");
			await tickDayTelemetry(host, t1);
			const day = await readDayTelemetryDay(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			assert.ok(day);
			const sum = day!.buckets.gridBalanceDischargeKwh.reduce<number>((a, v) => a + (v ?? 0), 0);
			assert.ok(sum > 0, `expected GB kWh > 0, got ${sum}`);
			const points = powerPointsFromGridBalanceDay(day!);
			assert.ok(points.some((p) => p.powerW > 0));

			const socPoints: SocPoint[] = [
				{ ts: Date.parse("2026-08-30T20:00:00+02:00"), socPct: 90 },
				{ ts: Date.parse("2026-08-31T06:00:00+02:00"), socPct: 65 },
			];
			const nightGb: PowerPoint[] = [];
			for (let h = 20; h < 30; h++) {
				const ts = Date.parse("2026-08-30T00:00:00+02:00") + h * 3_600_000;
				nightGb.push({ ts, powerW: 200 });
			}
			const baseline = computeNightDischarges({
				socPoints,
				nightStart: "22:00",
				nightEnd: "06:00",
				capacityKwh: 20,
				nowMs: Date.parse("2026-08-31T12:00:00+02:00"),
			});
			const withGb = computeNightDischarges({
				socPoints,
				nightStart: "22:00",
				nightEnd: "06:00",
				capacityKwh: 20,
				gridBalancePowerPoints: nightGb,
				nowMs: Date.parse("2026-08-31T12:00:00+02:00"),
			});
			assert.ok(baseline.avgKwh !== null && withGb.avgKwh !== null);
			assert.ok(withGb.avgKwh! < baseline.avgKwh!);
			assert.ok(withGb.gridBalanceAttributedNights >= 1);
			assert.equal(withGb.gridBalanceExcludedNights, 0);
		} finally {
			__resetDayTelemetryRuntimeForTest();
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
