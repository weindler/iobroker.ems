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
import { additionalGridBalancePowerW } from "../day_telemetry/sources";

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
	it("trennt 25 W Zusatzoffset vom normalen Hausdefizit", () => {
		assert.equal(additionalGridBalancePowerW({ active: true, setpointOwner: "grid_balance", batteryDischargeW: 325, houseW: 300, pvW: 0, effectiveSetpointW: 325 }), 25);
		assert.equal(additionalGridBalancePowerW({ active: false, setpointOwner: "grid_balance", batteryDischargeW: 325, houseW: 300, pvW: 0, effectiveSetpointW: 325 }), 0);
	});
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

	it("migriert alte volle Entladesollwerte zum zusätzlichen Offset", () => {
		const layout = buildDaySlotLayout("2026-09-11", "Europe/Berlin");
		const day = emptyDayRecord("2026-09-11", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
		delete day.gridBalanceEnergyKind;
		day.buckets.gridBalanceDischargeKwh[0] = 0.08125;
		day.buckets.houseTotalKwh[0] = 0.075;
		day.buckets.pvKwh[0] = 0;
		const points = powerPointsFromGridBalanceDay(day);
		assert.equal(points.length, 1);
		assert.ok(Math.abs(points[0]!.powerW - 25) < 1e-9);
	});

	it("Tick schreibt GB-Leistung in Day-Telemetry; SOC minus gemessene GB-kWh", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gb-tick-"));
		__resetDayTelemetryRuntimeForTest();
		try {
			const host = new FakeTelHost(dir);
			host.set(BAT.gridBalance.effectivePowerW, 400);
			host.set(BAT.gridBalance.active, true);
			host.set(BAT.runtime.batterySetpointOwner, "grid_balance");
			host.set(BAT.telemetry.dischargingPowerW, 400);
			host.set("live.battery.pv_ac_power_w", 0);
			host.config = { ...host.config, learning_house_load_power_state: "house.power" };
			host.set("house.power", 375);
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

	it("Realabnahme: 3,6 kWh brutto minus 25 W über 12 h ergibt rund 3,3 kWh", () => {
		const start = new Date(2026, 8, 11, 20, 30).getTime();
		const end = new Date(2026, 8, 12, 8, 30).getTime();
		const socPoints: SocPoint[] = [
			{ ts: start, socPct: 97 },
			{ ts: end, socPct: 61 },
		];
		const gridBalancePowerPoints: PowerPoint[] = [];
		for (let i = 0; i <= 48; i++) gridBalancePowerPoints.push({ ts: start + i * 15 * 60_000, powerW: 25 });
		const result = computeNightDischarges({ socPoints, nightStart: "20:30", nightEnd: "08:30", capacityKwh: 10, gridBalancePowerPoints, gridBalanceMaxAdditionalPowerW: 25, nowMs: end + 4 * 60 * 60_000 });
		assert.ok(result.avgKwh !== null);
		assert.ok(Math.abs(result.avgKwh! - 3.3) < 0.06, `got ${result.avgKwh}`);
		assert.ok(Math.abs((result.nightSamples[0]?.gridBalanceKwh ?? 0) - 0.3) < 0.03);
	});

	it("begrenzt alten Gesamt-Sollwert auf den konfigurierten 25-W-Zusatzoffset", () => {
		const start = new Date(2026, 8, 11, 20, 30).getTime();
		const end = new Date(2026, 8, 12, 8, 30).getTime();
		const socPoints: SocPoint[] = [
			{ ts: start, socPct: 97 },
			{ ts: end, socPct: 61 },
		];
		const legacyFullSetpoint: PowerPoint[] = [];
		for (let i = 0; i <= 48; i++) legacyFullSetpoint.push({ ts: start + i * 15 * 60_000, powerW: 270 });
		const result = computeNightDischarges({
			socPoints,
			nightStart: "20:30",
			nightEnd: "08:30",
			capacityKwh: 10,
			gridBalancePowerPoints: legacyFullSetpoint,
			gridBalanceMaxAdditionalPowerW: 25,
			nowMs: end + 4 * 60 * 60_000,
		});
		assert.ok(result.avgKwh !== null);
		assert.ok(Math.abs(result.avgKwh! - 3.3) < 0.06, `got ${result.avgKwh}`);
		assert.ok(Math.abs((result.nightSamples[0]?.gridBalanceKwh ?? 0) - 0.3) < 0.03);
	});
});
