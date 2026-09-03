/**
 * Predictive Climate Foundation — Day-Telemetry: Slots, Segmente, alte Dateien, DST.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { acUnitRuntimeStates } from "../../addons/air_conditioning/runtime/ensure_states.js";
import { AC_RUNTIME_SUMMARY_STATES } from "../../addons/air_conditioning/runtime/ensure_states.js";
import {
	__resetDayTelemetryRuntimeForTest,
	tickDayTelemetry,
	type DayTelemetryHost,
} from "./record.js";
import { normalizeDayRecord, readDayTelemetryDay } from "./persist.js";
import { emptyDayRecord } from "./types.js";
import { buildDaySlotLayout } from "./slots.js";
import { advanceClimateSegment, closeClimateSegment } from "./climate_segments.js";
import { computeClimateSharedPowerStats } from "../climate_shared_power/math.js";

class FakeTelHost implements DayTelemetryHost {
	states = new Map<string, ioBroker.StateValue>();
	dir: string;
	config: Record<string, unknown> = {
		timezone: "Europe/Berlin",
		ac_u1_enabled: true,
		ac_u1_mode_when_cooling: "cool",
		ac_u1_mode_when_heating: "",
		ac_u1_mode_when_dehumidify: "dry",
		ac_u1_on_temp_c: 26,
		ac_u1_off_temp_c: 24,
		ac_u1_max_humidity_pct: 60,
		ac_u1_shared_power_group_id: "outdoor_1",
		ac_u1_hard_off_at: "20:00",
		ac_u2_enabled: true,
		ac_u2_mode_when_cooling: "cool",
		ac_u2_mode_when_heating: "",
		ac_u2_shared_power_group_id: "outdoor_1",
		learning_weather_forecast_temp_state: "brightsky.0.daily.temperature_max",
		learning_weather_actual_temp_state: "brightsky.0.current.temperature",
		learning_weather_forecast_cloud_state: "brightsky.0.daily.cloud",
		learning_weather_actual_cloud_state: "brightsky.0.current.cloud",
	};
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

function setUnit(
	host: FakeTelHost,
	index: number,
	opts: {
		running?: boolean;
		purpose?: string;
		roomTempC?: number | null;
		humidity?: number | null;
		owner?: string;
		overrideUntil?: string;
		setpoint?: number | null;
	},
): void {
	const ids = acUnitRuntimeStates(index);
	if (opts.running != null) host.set(ids.running, opts.running);
	if (opts.purpose != null) host.set(ids.modePurpose, opts.purpose);
	if (opts.roomTempC !== undefined) host.set(ids.roomTempC, opts.roomTempC);
	if (opts.humidity !== undefined) host.set(ids.roomHumidityPct, opts.humidity);
	if (opts.owner != null) host.set(ids.ownershipOwner, opts.owner);
	if (opts.overrideUntil != null) host.set(ids.ownershipOverrideUntilIso, opts.overrideUntil);
	if (opts.setpoint !== undefined) host.set(ids.setpointTempC, opts.setpoint);
}

describe("climate foundation — day telemetry", () => {
	beforeEach(() => {
		__resetDayTelemetryRuntimeForTest();
	});

	it("persistiert Multi-Unit-Slot: Temp, Feuchte, Außen, Thresholds, Modi, Ownership, Shared", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cf-tel-"));
		try {
			const host = new FakeTelHost(dir);
			host.set("brightsky.0.current.temperature", 31.2);
			host.set("brightsky.0.current.cloud", 40);
			host.set(AC_RUNTIME_SUMMARY_STATES.systemPowerW, 720);
			host.set(AC_RUNTIME_SUMMARY_STATES.systemSharedPowerUsed, true);
			setUnit(host, 1, {
				running: true,
				purpose: "cooling",
				roomTempC: 27.4,
				humidity: 52,
				owner: "ems",
				setpoint: 17,
			});
			setUnit(host, 2, {
				running: true,
				purpose: "cooling",
				roomTempC: 26.1,
				humidity: 48,
				owner: "user",
				setpoint: 18,
			});
			const t0 = new Date("2026-08-30T11:00:00+02:00");
			await tickDayTelemetry(host, t0);
			await tickDayTelemetry(host, new Date("2026-08-30T11:01:00+02:00"));
			const day = await readDayTelemetryDay(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			assert.ok(day);
			const layout = buildDaySlotLayout("2026-08-30", "Europe/Berlin");
			const slot = layout.slots.find((s) => t0.getTime() >= s.startMs && t0.getTime() < s.endMs);
			assert.ok(slot);
			assert.equal(day!.buckets.outdoorTempC[slot!.index], 31.2);
			assert.equal(day!.buckets.cloudPct[slot!.index], 40);
			const units = day!.buckets.climateUnitSlots[slot!.index];
			assert.ok(units);
			assert.equal(units!.length, 2);
			const u1 = units!.find((u) => u.unitIndex === 1);
			const u2 = units!.find((u) => u.unitIndex === 2);
			assert.ok(u1 && u2);
			assert.equal(u1!.roomTempC, 27.4);
			assert.equal(u1!.roomHumidityPct, 52);
			assert.equal(u1!.targetTempC, 17);
			assert.equal(u1!.coolingOnTempC, 26);
			assert.equal(u1!.coolingOffTempC, 24);
			assert.equal(u1!.heatingSetpointC, null);
			assert.equal(u1!.maxHumidityPct, 60);
			assert.deepEqual(u1!.modesAvailable, ["cooling", "dehumidify"]);
			assert.equal(u1!.running, true);
			assert.equal(u1!.modePurpose, "cooling");
			assert.equal(u1!.hardOffAt, "20:00");
			assert.equal(u1!.ownershipOwner, "ems");
			assert.equal(u1!.overrideActive, false);
			assert.equal(u1!.sharedPowerGroupId, "outdoor_1");
			assert.equal(u1!.activeUnitCombination, "1+2");
			assert.equal(u2!.ownershipOwner, "user");
			assert.equal(u2!.overrideActive, true);
			assert.ok(!u1!.modesAvailable.includes("heating"));
			const onSeg = day!.climateRunSegments.find((s) => s.mode === "cooling" || s.valid);
			/* offenes Segment kann noch in mem sein — nach weiterem Idle schließen */
			host.set(acUnitRuntimeStates(1).running, false);
			host.set(acUnitRuntimeStates(2).running, false);
			await tickDayTelemetry(host, new Date("2026-08-30T11:02:00+02:00"));
			const day2 = await readDayTelemetryDay(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			const cooling = day2!.climateRunSegments.find((s) => s.mode === "cooling" || s.mode === "cool");
			assert.ok(cooling, "Cooling-Segment fehlt");
			assert.equal(cooling!.activeUnitCombination, "1+2");
			assert.equal(cooling!.sharedPowerGroupId, "outdoor_1");
			assert.ok(cooling!.unitObservations?.some((o) => o.unitIndex === 1 && o.roomTempStartC === 27.4));
			assert.equal(cooling!.outdoorTempStartC, 31.2);
			assert.ok(cooling!.energyKwh > 0);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("fehlende Werte bleiben null/unknown — keine erfundenen 0", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cf-miss-"));
		try {
			const host = new FakeTelHost(dir);
			host.config.learning_weather_forecast_temp_state = "";
			host.config.learning_weather_actual_temp_state = "";
			host.config.learning_weather_forecast_cloud_state = "";
			host.config.learning_weather_actual_cloud_state = "";
			setUnit(host, 1, { running: false, purpose: "off", roomTempC: null, humidity: null });
			const t0 = new Date("2026-08-30T11:00:00+02:00");
			await tickDayTelemetry(host, t0);
			await tickDayTelemetry(host, new Date("2026-08-30T11:01:00+02:00"));
			const day = await readDayTelemetryDay(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			const layout = buildDaySlotLayout("2026-08-30", "Europe/Berlin");
			const slot = layout.slots.find((s) => t0.getTime() >= s.startMs && t0.getTime() < s.endMs);
			assert.equal(day!.buckets.outdoorTempC[slot!.index], null);
			const u1 = day!.buckets.climateUnitSlots[slot!.index]?.find((u) => u.unitIndex === 1);
			assert.ok(u1);
			assert.equal(u1!.roomTempC, null);
			assert.equal(u1!.roomHumidityPct, null);
			assert.equal(u1!.demandUrgency01, null);
			assert.equal(u1!.modePurpose, "off");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("alte Tagesdateien ohne Climate-Felder bleiben lesbar", () => {
		const layout = buildDaySlotLayout("2026-06-15", "Europe/Berlin");
		const day = emptyDayRecord("2026-06-15", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
		const raw = JSON.parse(JSON.stringify(day)) as Record<string, unknown>;
		const buckets = raw.buckets as Record<string, unknown>;
		delete buckets.outdoorTempC;
		delete buckets.cloudPct;
		delete buckets.climateUnitSlots;
		const n = normalizeDayRecord(raw, "2026-06-15");
		assert.ok(n);
		assert.equal(n!.buckets.outdoorTempC.length, n!.slotCount);
		assert.equal(n!.buckets.cloudPct.length, n!.slotCount);
		assert.equal(n!.buckets.climateUnitSlots.length, n!.slotCount);
		assert.ok(n!.buckets.outdoorTempC.every((v) => v === null));
		assert.ok(n!.buckets.climateUnitSlots.every((v) => v === null));
	});

	it("DST-Tage behalten 92/96/100 Slots inkl. neuer Climate-Arrays", () => {
		const spring = buildDaySlotLayout("2026-03-29", "Europe/Berlin");
		const normal = buildDaySlotLayout("2026-06-15", "Europe/Berlin");
		const fall = buildDaySlotLayout("2026-10-25", "Europe/Berlin");
		assert.equal(spring.slotCount, 92);
		assert.equal(normal.slotCount, 96);
		assert.equal(fall.slotCount, 100);
		const rec = emptyDayRecord("2026-03-29", "Europe/Berlin", spring.startMs, spring.endMs, spring.slotCount);
		assert.equal(rec.buckets.outdoorTempC.length, 92);
		assert.equal(rec.buckets.climateUnitSlots.length, 92);
	});

	it("Idle-Segmente sind thermisch nutzbar und elektrisch nicht lernfähig", () => {
		let list: import("./types.js").ClimateRunSegment[] = [];
		const step = advanceClimateSegment(
			null,
			1_000,
			{ sharedPowerGroupId: null, mode: "off", activeUnitCombination: "none", valid: false },
			0,
			900,
			"climate_idle",
			list,
			{
				outdoorTempC: 22,
				units: [{ unitIndex: 1, roomTempC: 24, roomHumidityPct: 50, ownershipOwner: "ems", overrideActive: false }],
			},
		);
		list = closeClimateSegment(step.open, 1_000 + 1_800_000, step.list);
		assert.equal(list.length, 1);
		assert.equal(list[0].mode, "off");
		assert.equal(list[0].valid, false);
		assert.equal(list[0].rejectReason, "climate_idle");
		assert.equal(list[0].unitObservations?.[0]?.roomTempStartC, 24);
		assert.equal(list[0].thermalUsable, true);
		const stats = computeClimateSharedPowerStats(
			[{ ...list[0], endTs: list[0].endTs }],
			Date.now(),
		);
		assert.deepEqual(stats, {});
	});

	it("Heating- und Cooling-Segmente werden nicht vermischt; fehlende Startwerte nicht geschätzt", () => {
		let list: import("./types.js").ClimateRunSegment[] = [];
		const cool = advanceClimateSegment(
			null,
			1_000,
			{ sharedPowerGroupId: "outdoor_1", mode: "cooling", activeUnitCombination: "1", valid: true },
			0.1,
			60,
			null,
			list,
			{
				outdoorTempC: 30,
				units: [{ unitIndex: 1, roomTempC: 27, roomHumidityPct: null, ownershipOwner: "ems", overrideActive: false }],
			},
		);
		const heat = advanceClimateSegment(
			cool.open,
			2_000,
			{ sharedPowerGroupId: "outdoor_1", mode: "heating", activeUnitCombination: "1", valid: true },
			0.1,
			60,
			null,
			cool.list,
			{
				outdoorTempC: 5,
				units: [{ unitIndex: 1, roomTempC: 18, roomHumidityPct: 40, ownershipOwner: "ems", overrideActive: false }],
			},
		);
		list = closeClimateSegment(heat.open, 3_000, heat.list);
		assert.equal(list.length, 2);
		assert.equal(list[0].mode, "cooling");
		assert.equal(list[1].mode, "heating");
		assert.equal(list[0].unitObservations?.[0]?.roomTempStartC, 27);
		assert.equal(list[1].unitObservations?.[0]?.roomHumidityStartPct, 40);
	});
});
