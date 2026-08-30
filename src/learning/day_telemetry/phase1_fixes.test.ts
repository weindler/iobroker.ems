/**
 * Phase-1-Fixes: PV-Quelle, Quality/Coverage, Persistenz Tagesdateien, Snapshot-Host.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DIAGNOSTIC_FILE_MODE } from "../../persistence/atomic_write.js";
import {
	__resetDayTelemetryRuntimeForTest,
	tickDayTelemetry,
	noteDayTelemetryPlanPublished,
	type DayTelemetryHost,
} from "./record.js";
import {
	migrateMonolithToDayFiles,
	readDayTelemetryDay,
	dayTelemetryDayPath,
	pruneDayTelemetryFiles,
	writeDayTelemetryPersist,
} from "./persist.js";
import { DOMAIN_QUALITY, TELEMETRY_DOMAIN, decodeDomainQuality } from "./quality_mask.js";
import { emptyDayRecord, emptyDayTelemetryStore, refreshDayCoverage } from "./types.js";
import { buildDaySlotLayout } from "./slots.js";
import { DAY_TELEMETRY_LEGACY_MONOLITH_FILE, DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT } from "./constants.js";
import type { UnifiedDayPlan, UnifiedDayPlannerInput } from "../../operator/daily_plan/unified/types.js";

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

function minimalPlan(date: string): UnifiedDayPlan {
	return {
		planId: "p1",
		generation: 1,
		date,
		timezone: "Europe/Berlin",
		allocations: [],
		reasonCodes: [],
	} as unknown as UnifiedDayPlan;
}

function minimalInput(): UnifiedDayPlannerInput {
	return {
		time: { timezone: "Europe/Berlin", nowIso: new Date().toISOString() },
		globalMode: "balanced",
		pv: { expectedDayEnergyKwh: 10, slots: [] },
		houseLoad: { expectedDayEnergyKwh: 8 },
		battery: { socPct: 50, usableCapacityKwh: 10, nightReserveKwh: 2 },
		prices: { slots: [] },
		climate: { units: [] },
	} as unknown as UnifiedDayPlannerInput;
}

describe("day_telemetry phase1 fixes", () => {
	beforeEach(() => {
		__resetDayTelemetryRuntimeForTest();
	});

	it("PV Live-Wert integriert pvKwh > 0", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-pv-"));
		try {
			const host = new FakeTelHost(dir);
			host.set("live.battery.pv_ac_power_w", 2000);
			const t0 = new Date("2026-08-30T10:00:00+02:00");
			await tickDayTelemetry(host, t0);
			const t1 = new Date("2026-08-30T10:01:00+02:00");
			await tickDayTelemetry(host, t1);
			const day = await readDayTelemetryDay(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			assert.ok(day);
			const sum = day!.buckets.pvKwh.reduce<number>((a, v) => a + (v ?? 0), 0);
			assert.ok(sum > 0, `expected pvKwh sum > 0, got ${sum}`);
			const anyOk = day!.buckets.qualityMask.some(
				(m) => m != null && decodeDomainQuality(m, TELEMETRY_DOMAIN.PV) === DOMAIN_QUALITY.ok,
			);
			assert.equal(anyOk, true);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("fehlender PV → quality missing, pvKwh null", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-pvmiss-"));
		try {
			const host = new FakeTelHost(dir);
			/* kein PV-State */
			const t0 = new Date("2026-08-30T10:00:00+02:00");
			await tickDayTelemetry(host, t0);
			const t1 = new Date("2026-08-30T10:01:00+02:00");
			await tickDayTelemetry(host, t1);
			const day = await readDayTelemetryDay(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			assert.ok(day);
			const pvSum = day!.buckets.pvKwh.reduce<number>((a, v) => a + (v ?? 0), 0);
			assert.equal(pvSum, 0);
			const anyMissing = day!.buckets.qualityMask.some(
				(m) => m != null && decodeDomainQuality(m, TELEMETRY_DOMAIN.PV) === DOMAIN_QUALITY.missing,
			);
			assert.equal(anyMissing, true);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("0 W PV ist gültig (ok), nicht missing", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-pv0-"));
		try {
			const host = new FakeTelHost(dir);
			host.set("live.battery.pv_ac_power_w", 0);
			const t0 = new Date("2026-08-30T10:00:00+02:00");
			await tickDayTelemetry(host, t0);
			const t1 = new Date("2026-08-30T10:01:00+02:00");
			await tickDayTelemetry(host, t1);
			const day = await readDayTelemetryDay(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			assert.ok(day);
			const anyMissing = day!.buckets.qualityMask.some(
				(m) => m != null && decodeDomainQuality(m, TELEMETRY_DOMAIN.PV) === DOMAIN_QUALITY.missing,
			);
			assert.equal(anyMissing, false);
			const anyOk = day!.buckets.qualityMask.some(
				(m) => m != null && decodeDomainQuality(m, TELEMETRY_DOMAIN.PV) === DOMAIN_QUALITY.ok,
			);
			assert.equal(anyOk, true);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("unobserved Slot: qualityMask null, nicht ok", () => {
		const layout = buildDaySlotLayout("2026-08-29", "Europe/Berlin");
		const day = emptyDayRecord("2026-08-29", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
		assert.equal(day.buckets.qualityMask[0], null);
		refreshDayCoverage(day);
		assert.equal(day.observedSlotCount, 0);
		assert.equal(day.coveragePct, 0);
		assert.equal(day.evaluable, false);
		assert.equal(day.complete, false);
	});

	it("Teil-Tag: complete kann true sein bei niedriger Coverage", () => {
		const layout = buildDaySlotLayout("2026-08-29", "Europe/Berlin");
		const day = emptyDayRecord("2026-08-29", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
		/* nur wenige Slots beobachtet */
		for (let i = 70; i < 80; i++) {
			day.buckets.qualityMask[i] = 0;
		}
		day.complete = true;
		refreshDayCoverage(day);
		assert.equal(day.complete, true);
		assert.ok(day.coveragePct < 100);
		assert.ok(day.coveragePct < DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT);
		assert.equal(day.evaluable, false);
	});

	it("Plan-Publish persistiert Snapshot + Replan; snapshotIdRef auflösbar", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-snap-"));
		try {
			const host = new FakeTelHost(dir);
			host.set("live.battery.pv_ac_power_w", 100);
			const now = new Date("2026-08-30T12:00:00+02:00");
			await noteDayTelemetryPlanPublished({
				host,
				now,
				timezone: "Europe/Berlin",
				plan: minimalPlan("2026-08-30"),
				plannerInput: minimalInput(),
				replanReasons: ["replan_pv_forecast_changed"],
			});
			const day = await readDayTelemetryDay(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			assert.ok(day);
			assert.ok(day!.forecastSnapshots.length >= 1);
			assert.ok(day!.replanEvents.length >= 1);
			const snapId = day!.replanEvents[0].snapshotId;
			assert.ok(day!.forecastSnapshots.some((s) => s.id === snapId));
			/* Neustart-Simulation: Runtime reset, Datei bleibt */
			__resetDayTelemetryRuntimeForTest();
			const day2 = await readDayTelemetryDay(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			assert.ok(day2!.forecastSnapshots.some((s) => s.id === snapId));
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("Monolith-Migration → Tagesdateien, idempotent", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-mig-"));
		try {
			const layout = buildDaySlotLayout("2026-08-29", "Europe/Berlin");
			const store = emptyDayTelemetryStore();
			store.days["2026-08-29"] = emptyDayRecord(
				"2026-08-29",
				"Europe/Berlin",
				layout.startMs,
				layout.endMs,
				layout.slotCount,
			);
			await fs.writeFile(
				path.join(dir, DAY_TELEMETRY_LEGACY_MONOLITH_FILE),
				JSON.stringify(store),
				"utf8",
			);
			const r1 = await migrateMonolithToDayFiles(dir);
			assert.equal(r1.migrated, true);
			assert.equal(r1.dayCount, 1);
			const day = await readDayTelemetryDay(dir, "2026-08-29");
			assert.ok(day);
			const r2 = await migrateMonolithToDayFiles(dir);
			assert.equal(r2.migrated, false);
			/* Monolith weg / .migrated */
			await assert.rejects(fs.access(path.join(dir, DAY_TELEMETRY_LEGACY_MONOLITH_FILE)));
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("90-Tage-Retention löscht alte Tagesdateien", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-ret-"));
		try {
			const store = emptyDayTelemetryStore();
			for (let i = 0; i < 95; i++) {
				const dk = `2026-01-${String(i + 1).padStart(2, "0")}`;
				if (i + 1 > 31) break;
			}
			/* 95 Tage ab 2026-01-01 */
			const { addDaysToDateKey } = await import("../../operator/time.js");
			const start = "2026-01-01";
			for (let i = 0; i < 95; i++) {
				const dk = addDaysToDateKey(start, i);
				const layout = buildDaySlotLayout(dk, "Europe/Berlin");
				store.days[dk] = emptyDayRecord(dk, "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
			}
			await writeDayTelemetryPersist(dir, store);
			const today = addDaysToDateKey(start, 94);
			const removed = await pruneDayTelemetryFiles(dir, 90, today);
			assert.ok(removed.length >= 5);
			const dayPath = dayTelemetryDayPath(dir, start);
			await assert.rejects(fs.access(dayPath));
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("atomisches Write → Dateimode lesbar (0644)", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-mode-"));
		try {
			const host = new FakeTelHost(dir);
			host.set("live.battery.pv_ac_power_w", 500);
			await tickDayTelemetry(host, new Date("2026-08-30T11:00:00+02:00"));
			await tickDayTelemetry(host, new Date("2026-08-30T11:01:00+02:00"));
			const fp = dayTelemetryDayPath(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			const st = await fs.stat(fp);
			const mode = st.mode & 0o777;
			assert.equal(mode, DIAGNOSTIC_FILE_MODE);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
