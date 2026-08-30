/**
 * Block A — Regressionstests für additive Telemetrie-/Snapshot-Erweiterungen.
 * Ziel: neue Felder korrekt befüllt, bestehendes Verhalten (Buckets, Coverage,
 * Climate-Segmente) unverändert wenn Erweiterungen nicht genutzt werden.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	__resetDayTelemetryRuntimeForTest,
	tickDayTelemetry,
	noteDayTelemetryPlanPublished,
	type DayTelemetryHost,
} from "./record.js";
import { readDayTelemetryDay } from "./persist.js";
import {
	buildPlannerKnowledgeSnapshot,
	withSnapshotId,
	type BatteryDecisionSnapshotInput,
} from "./knowledge_snapshot.js";
import {
	advanceImmersionSegment,
	closeImmersionSegment,
} from "./immersion_segments.js";
import type { UnifiedDayPlan, UnifiedDayPlannerInput, UnifiedDataFreshness } from "../../operator/daily_plan/unified/types.js";

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

const fresh: UnifiedDataFreshness = {
	observedAtIso: "2026-06-15T08:00:00.000Z",
	ageSec: 0,
	quality: { status: "valid", confidencePct: 100, reasonDe: "" },
};

function minimalInput(overrides: Partial<UnifiedDayPlannerInput> = {}): UnifiedDayPlannerInput {
	return {
		time: { timezone: "Europe/Berlin", nowIso: new Date().toISOString() },
		globalMode: "balanced",
		pv: { expectedDayEnergyKwh: 10, slots: [] },
		houseLoad: { expectedDayEnergyKwh: 8 },
		battery: { socPct: 50, usableCapacityKwh: 10, nightReserveKwh: 2 },
		prices: { slots: [] },
		climate: { units: [] },
		wallbox: null,
		...overrides,
	} as unknown as UnifiedDayPlannerInput;
}

describe("Block A — additive Snapshot-Erweiterungen (Wallbox/Battery)", () => {
	it("ohne extra-Param bleibt batteryDecision null (Rückwärtskompatibilität)", () => {
		const snap = buildPlannerKnowledgeSnapshot(minimalInput(), "t1");
		assert.equal(snap.batteryDecision, null);
		assert.equal(snap.wallboxTargetSocPct, null);
		assert.equal(snap.wallboxManagementMode, null);
	});

	it("Wallbox-Zielwerte werden 1:1 aus input.wallbox gespiegelt", () => {
		const snap = buildPlannerKnowledgeSnapshot(
			minimalInput({
				wallbox: {
					targetSocPct: 80,
					minimumDepartureSocPct: 60,
					energyGoalHard: true,
					managementMode: "ems_candidate",
					deadlineIso: "2026-06-16T06:00:00.000Z",
				} as unknown as UnifiedDayPlannerInput["wallbox"],
			}),
			"t1",
		);
		assert.equal(snap.wallboxTargetSocPct, 80);
		assert.equal(snap.wallboxMinimumDepartureSocPct, 60);
		assert.equal(snap.wallboxEnergyGoalHard, true);
		assert.equal(snap.wallboxManagementMode, "ems_candidate");
		assert.equal(snap.wallboxDeadlineIso, "2026-06-16T06:00:00.000Z");
	});

	it("batteryDecision: hold_active hat Vorrang vor discharge_allowed", () => {
		const ctx: BatteryDecisionSnapshotInput = {
			dischargeAllowed: true,
			priceAllowed: true,
			socAllowed: true,
			requiredSocAtPvEndPct: 30,
			holdActive: true,
		};
		const snap = buildPlannerKnowledgeSnapshot(minimalInput(), "t1", { batteryDecision: ctx });
		assert.deepEqual(snap.batteryDecision, {
			action: "hold",
			dischargeAllowed: true,
			requiredSocAtPvEndPct: 30,
			holdActive: true,
			reasonCode: "battery_hold_active",
		});
	});

	it("batteryDecision: discharge_allowed wenn Preis+Reserve ok und kein Hold", () => {
		const ctx: BatteryDecisionSnapshotInput = {
			dischargeAllowed: true,
			priceAllowed: true,
			socAllowed: true,
			requiredSocAtPvEndPct: 30,
			holdActive: false,
		};
		const snap = buildPlannerKnowledgeSnapshot(minimalInput(), "t1", { batteryDecision: ctx });
		assert.equal(snap.batteryDecision?.action, "discharge_allowed");
		assert.equal(snap.batteryDecision?.reasonCode, "price_and_reserve_ok");
	});

	it("batteryDecision: reserve_unknown wenn requiredSocAtPvEndPct null", () => {
		const ctx: BatteryDecisionSnapshotInput = {
			dischargeAllowed: false,
			priceAllowed: true,
			socAllowed: false,
			requiredSocAtPvEndPct: null,
			holdActive: false,
		};
		const snap = buildPlannerKnowledgeSnapshot(minimalInput(), "t1", { batteryDecision: ctx });
		assert.equal(snap.batteryDecision?.action, "discharge_blocked");
		assert.equal(snap.batteryDecision?.reasonCode, "reserve_unknown");
	});

	it("batteryDecision: price_blocked wenn Preis nicht erlaubt, Reserve bekannt", () => {
		const ctx: BatteryDecisionSnapshotInput = {
			dischargeAllowed: false,
			priceAllowed: false,
			socAllowed: true,
			requiredSocAtPvEndPct: 30,
			holdActive: false,
		};
		const snap = buildPlannerKnowledgeSnapshot(minimalInput(), "t1", { batteryDecision: ctx });
		assert.equal(snap.batteryDecision?.reasonCode, "price_blocked");
	});

	it("Snapshot-Hash ändert sich bei neuem batteryDecision-Kontext (kein Dedup-Fehlschluss)", () => {
		const withoutCtx = withSnapshotId(buildPlannerKnowledgeSnapshot(minimalInput(), "t1"));
		const withCtx = withSnapshotId(
			buildPlannerKnowledgeSnapshot(minimalInput(), "t2", {
				batteryDecision: {
					dischargeAllowed: true,
					priceAllowed: true,
					socAllowed: true,
					requiredSocAtPvEndPct: 30,
					holdActive: false,
				},
			}),
		);
		assert.notEqual(withoutCtx.id, withCtx.id);
	});
});

describe("Block A — immersion_segments (reine Funktionen)", () => {
	it("on→off schließt Segment mit Kontext aus Startzeitpunkt", () => {
		const ctx = {
			decisionSource: "daily_plan",
			forcedMode: false,
			hygieneStatusDe: "Hygiene erfüllt.",
			ownershipOwner: "ems",
		};
		const t0 = 1000;
		const opened = advanceImmersionSegment(null, t0, true, 0.1, 60, ctx, []);
		assert.ok(opened.open);
		/* Kontextänderung während des Laufs darf Start-Kontext nicht überschreiben */
		const advanced = advanceImmersionSegment(
			opened.open,
			t0 + 60_000,
			true,
			0.1,
			60,
			{ ...ctx, forcedMode: true },
			opened.list,
		);
		assert.equal(advanced.open?.forcedMode, false);
		const closed = advanceImmersionSegment(advanced.open, t0 + 120_000, false, 0, 0, ctx, advanced.list);
		assert.equal(closed.open, null);
		assert.equal(closed.list.length, 1);
		assert.equal(closed.list[0].decisionSource, "daily_plan");
		assert.equal(closed.list[0].forcedMode, false);
		assert.equal(closed.list[0].runtimeSec, 120);
	});

	it("Segment mit 0 Laufzeit wird nicht persistiert (closeImmersionSegment)", () => {
		const list = closeImmersionSegment(
			{ startTs: 5000, energyKwh: 0, runtimeSec: 0, decisionSource: null, forcedMode: null, hygieneStatusDe: null, ownershipOwner: null },
			5000,
			[],
		);
		assert.equal(list.length, 0);
	});
});

describe("Block A — immersionRunSegments im echten Tick (Live-Mirror, kein Recompute)", () => {
	beforeEach(() => {
		__resetDayTelemetryRuntimeForTest();
	});

	it("Heizstab-Lauf erzeugt Segment mit gespiegeltem decisionSource/resolvedMode", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-ih-seg-"));
		try {
			const host = new FakeTelHost(dir);
			host.set("addons.immersion_heater.runtime.measured_power_w", 2000);
			host.set("addons.immersion_heater.runtime.commanded_power_w", 2000);
			host.set("addons.immersion_heater.runtime.decision_source", "daily_plan");
			host.set("addons.immersion_heater.runtime.resolved_mode", "auto");
			host.set("addons.immersion_heater.runtime.hygiene_status_de", "Hygiene erfüllt.");
			host.set("addons.immersion_heater.runtime.ownership_owner", "ems");

			const t0 = new Date("2026-08-30T10:00:00+02:00");
			await tickDayTelemetry(host, t0);
			const t1 = new Date("2026-08-30T10:05:00+02:00");
			await tickDayTelemetry(host, t1);
			/* Lauf endet */
			host.set("addons.immersion_heater.runtime.measured_power_w", 0);
			host.set("addons.immersion_heater.runtime.commanded_power_w", 0);
			const t2 = new Date("2026-08-30T10:10:00+02:00");
			await tickDayTelemetry(host, t2);

			const day = await readDayTelemetryDay(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			assert.ok(day);
			assert.ok(day!.immersionRunSegments.length >= 1);
			const seg = day!.immersionRunSegments[0];
			assert.equal(seg.decisionSource, "daily_plan");
			assert.equal(seg.forcedMode, false);
			assert.equal(seg.hygieneStatusDe, "Hygiene erfüllt.");
			assert.equal(seg.ownershipOwner, "ems");
			assert.ok(seg.runtimeSec > 0);
			assert.ok(seg.energyKwh > 0);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("Force-Modus wird als forcedMode=true gespiegelt", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-ih-force-"));
		try {
			const host = new FakeTelHost(dir);
			host.set("addons.immersion_heater.runtime.measured_power_w", 2000);
			host.set("addons.immersion_heater.runtime.commanded_power_w", 2000);
			host.set("addons.immersion_heater.runtime.resolved_mode", "force");

			const t0 = new Date("2026-08-30T10:00:00+02:00");
			await tickDayTelemetry(host, t0);
			const t1 = new Date("2026-08-30T10:05:00+02:00");
			await tickDayTelemetry(host, t1);
			host.set("addons.immersion_heater.runtime.measured_power_w", 0);
			host.set("addons.immersion_heater.runtime.commanded_power_w", 0);
			const t2 = new Date("2026-08-30T10:10:00+02:00");
			await tickDayTelemetry(host, t2);

			const day = await readDayTelemetryDay(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			assert.ok(day);
			assert.ok(day!.immersionRunSegments.length >= 1);
			assert.equal(day!.immersionRunSegments[0].forcedMode, true);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("kein Heizstab-Lauf → keine Segmente, bestehende Buckets bleiben unverändert (Regression)", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-ih-none-"));
		try {
			const host = new FakeTelHost(dir);
			host.set("live.battery.pv_ac_power_w", 1000);
			const t0 = new Date("2026-08-30T10:00:00+02:00");
			await tickDayTelemetry(host, t0);
			const t1 = new Date("2026-08-30T10:05:00+02:00");
			await tickDayTelemetry(host, t1);
			const day = await readDayTelemetryDay(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			assert.ok(day);
			assert.equal(day!.immersionRunSegments.length, 0);
			const pvSum = day!.buckets.pvKwh.reduce<number>((a, v) => a + (v ?? 0), 0);
			assert.ok(pvSum > 0);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("Plan-Publish mit batteryDecision-Kontext: Snapshot enthält batteryDecision, bestehende Felder unverändert", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-snap-bd-"));
		try {
			const host = new FakeTelHost(dir);
			const now = new Date("2026-08-30T12:00:00+02:00");
			await noteDayTelemetryPlanPublished({
				host,
				now,
				timezone: "Europe/Berlin",
				plan: minimalPlan("2026-08-30"),
				plannerInput: minimalInput(),
				replanReasons: ["replan_pv_forecast_changed"],
				batteryDecision: {
					dischargeAllowed: true,
					priceAllowed: true,
					socAllowed: true,
					requiredSocAtPvEndPct: 25,
					holdActive: false,
				},
			});
			const day = await readDayTelemetryDay(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			assert.ok(day);
			assert.equal(day!.forecastSnapshots.length, 1);
			const snap = day!.forecastSnapshots[0];
			assert.equal(snap.batteryDecision?.action, "discharge_allowed");
			assert.equal(snap.batteryDecision?.requiredSocAtPvEndPct, 25);
			/* bestehende Felder unverändert befüllt */
			assert.equal(snap.batterySocPct, 50);
			assert.equal(snap.globalMode, "balanced");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("Plan-Publish ohne batteryDecision-Kontext (Altverhalten): Snapshot.batteryDecision = null", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-snap-nobd-"));
		try {
			const host = new FakeTelHost(dir);
			const now = new Date("2026-08-30T12:00:00+02:00");
			await noteDayTelemetryPlanPublished({
				host,
				now,
				timezone: "Europe/Berlin",
				plan: minimalPlan("2026-08-30"),
				plannerInput: minimalInput(),
				replanReasons: [],
			});
			const day = await readDayTelemetryDay(path.join(dir, "learning/day_telemetry"), "2026-08-30");
			assert.ok(day);
			assert.equal(day!.forecastSnapshots[0].batteryDecision, null);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
