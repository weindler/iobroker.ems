import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GRID_SUPPLY_STATE_IDS } from "../../operator/supply/grid_states.js";
import { DEFAULT_PRICE_STATE_ID } from "../price_learning/constants.js";
import {
	buildPlannerKnowledgeSnapshot,
	withSnapshotId,
	upsertForecastSnapshot,
} from "./knowledge_snapshot.js";
import { resolveTelemetryPriceCtPerKwh } from "./sources.js";
import type { UnifiedDayPlannerInput, UnifiedDataFreshness } from "../../operator/daily_plan/unified/types.js";

type MockState = { val: ioBroker.StateValue };

class FakeHost {
	states = new Map<string, MockState>();
	config = {};
	async getStateAsync(id: string): Promise<ioBroker.State | null> {
		const s = this.states.get(id);
		if (!s) return null;
		return { val: s.val, ack: true, ts: Date.now(), lc: Date.now(), from: "", q: 0 } as ioBroker.State;
	}
}

const fresh: UnifiedDataFreshness = {
	observedAtIso: "2026-06-15T08:00:00.000Z",
	ageSec: 0,
	quality: { status: "valid", confidencePct: 100, reasonDe: "" },
};

function minimalInput(priceCt: number): UnifiedDayPlannerInput {
	return {
		schemaVersion: 1,
		planIntent: "unified_day",
		time: {
			nowIso: "2026-06-15T08:00:00.000Z",
			timezone: "Europe/Berlin",
			horizonStartIso: "2026-06-15T08:00:00.000Z",
			horizonEndIso: "2026-06-17T08:00:00.000Z",
			slotMinutes: 15,
			slots: [],
			freshness: fresh,
		},
		pv: {
			slots: [],
			expectedDayEnergyKwh: 20,
			previousExpectedDayEnergyKwh: null,
			biasCorrected: false,
			biasPct: null,
			uncertainty: { status: "valid", confidencePct: 80, reasonDe: "" },
			freshness: fresh,
		},
		prices: {
			slots: [
				{
					slot: { startIso: "2026-06-15T08:00:00.000Z", endIso: "2026-06-15T08:15:00.000Z" },
					importCtPerKwh: priceCt,
					exportCtPerKwh: 8,
					gridImportAllowed: true,
				},
			],
			uncertainty: { status: "valid", confidencePct: 100, reasonDe: "" },
			freshness: fresh,
		},
		houseLoad: {
			slots: [],
			expectedDayEnergyKwh: 12,
			uncertainty: { status: "valid", confidencePct: 70, reasonDe: "" },
			freshness: fresh,
		},
		battery: {
			socPct: 55,
			usableCapacityKwh: 10,
			minSocPct: 10,
			maxSocPct: 100,
			maxChargePowerW: 3000,
			maxDischargePowerW: 3000,
			chargeEfficiency: 0.95,
			dischargeEfficiency: 0.95,
			allowedModes: ["charge"],
			reserveSocPct: 20,
			nightReserveKwh: 2,
			profileId: null,
			dischargeLiveSupported: false,
			passiveBatteryEnergyAvailable: true,
			requiredChargeEnergyKwh: null,
			endSocTargetPct: null,
			chargeDeadlineIso: null,
			gridChargeAllowed: true,
			uncertainty: { status: "valid", confidencePct: 90, reasonDe: "" },
			freshness: fresh,
		},
		wallbox: null,
		thermal: null,
		climate: null,
		otherFlex: [],
		contributionRevision: 1,
		globalMode: "balanced",
	};
}

describe("day_telemetry price source", () => {
	it("kein Plan publiziert, Tarifpreis vorhanden → Telemetriepreis vorhanden", async () => {
		const host = new FakeHost();
		const nowMs = Date.parse("2026-06-15T10:07:00.000Z");
		host.states.set(GRID_SUPPLY_STATE_IDS.slotsJson, {
			val: JSON.stringify([
				{
					startIso: "2026-06-15T10:00:00.000Z",
					endIso: "2026-06-15T10:15:00.000Z",
					priceCtPerKwh: 24.5,
				},
			]),
		});
		/* plan_json absichtlich fehlt / anders */
		host.states.set("planner.intent.daily_plan.plan_json", {
			val: JSON.stringify({
				slots: [
					{
						startIso: "2026-06-15T10:00:00.000Z",
						endIso: "2026-06-15T10:15:00.000Z",
						importCtPerKwh: 99.9,
					},
				],
			}),
		});
		const ct = await resolveTelemetryPriceCtPerKwh(host, nowMs);
		assert.equal(ct, 24.5);
	});

	it("live.price Fallback wenn keine Slots", async () => {
		const host = new FakeHost();
		host.states.set(DEFAULT_PRICE_STATE_ID, { val: 31.2 });
		const ct = await resolveTelemetryPriceCtPerKwh(host, Date.now());
		assert.equal(ct, 31.2);
	});

	it("Tarifpreis fehlt → null (PRICE missing)", async () => {
		const host = new FakeHost();
		host.states.set("planner.intent.daily_plan.plan_json", {
			val: JSON.stringify({
				slots: [{ startIso: "2026-06-15T10:00:00.000Z", endIso: "2026-06-15T10:15:00.000Z", importCtPerKwh: 50 }],
			}),
		});
		const ct = await resolveTelemetryPriceCtPerKwh(host, Date.parse("2026-06-15T10:07:00.000Z"));
		assert.equal(ct, null);
	});

	it("Planner-Snapshot behält damaligen Preisforecast unverändert", () => {
		const snapA = withSnapshotId(buildPlannerKnowledgeSnapshot(minimalInput(22), "t1"));
		const list1 = upsertForecastSnapshot([], snapA).list;
		const snapB = withSnapshotId(buildPlannerKnowledgeSnapshot(minimalInput(40), "t2"));
		const list2 = upsertForecastSnapshot(list1, snapB).list;
		assert.equal(list2.length, 2);
		assert.deepEqual(list2[0].priceSlots, [[Date.parse("2026-06-15T08:00:00.000Z"), 22]]);
		assert.deepEqual(list2[1].priceSlots, [[Date.parse("2026-06-15T08:00:00.000Z"), 40]]);
	});
});
