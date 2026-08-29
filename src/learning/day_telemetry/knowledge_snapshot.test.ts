import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UnifiedDayPlannerInput, UnifiedDataFreshness } from "../../operator/daily_plan/unified/types.js";
import {
	buildPlannerKnowledgeSnapshot,
	upsertForecastSnapshot,
	withSnapshotId,
} from "./knowledge_snapshot.js";

const fresh: UnifiedDataFreshness = {
	observedAtIso: "2026-06-15T08:00:00.000Z",
	ageSec: 0,
	quality: { status: "valid", confidencePct: 100, reasonDe: "" },
};

function minimalInput(overrides: Partial<UnifiedDayPlannerInput> = {}): UnifiedDayPlannerInput {
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
			slots: [
				{
					slot: { startIso: "2026-06-15T08:00:00.000Z", endIso: "2026-06-15T08:15:00.000Z" },
					forecastPowerW: 1000,
					observedPowerW: null,
					energyKwh: 0.25,
				},
			],
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
					importCtPerKwh: 25,
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
		...overrides,
	};
}

describe("day_telemetry knowledge snapshot", () => {
	it("13) Snapshot-Dedup bei gleichem Inhalt", () => {
		const a = withSnapshotId(buildPlannerKnowledgeSnapshot(minimalInput(), "2026-06-15T08:00:00.000Z"));
		const b = withSnapshotId(buildPlannerKnowledgeSnapshot(minimalInput(), "2026-06-15T09:00:00.000Z"));
		assert.equal(a.id, b.id);
		const up1 = upsertForecastSnapshot([], a);
		const up2 = upsertForecastSnapshot(up1.list, b);
		assert.equal(up2.inserted, false);
		assert.equal(up2.list.length, 1);
	});

	it("12) Snapshot bleibt historisch unverändert bei Input-Änderung", () => {
		const first = withSnapshotId(buildPlannerKnowledgeSnapshot(minimalInput(), "t1"));
		const list = [first];
		const changed = withSnapshotId(
			buildPlannerKnowledgeSnapshot(
				minimalInput({
					pv: {
						...minimalInput().pv,
						expectedDayEnergyKwh: 30,
					},
				}),
				"t2",
			),
		);
		const up = upsertForecastSnapshot(list, changed);
		assert.equal(up.inserted, true);
		assert.equal(up.list.length, 2);
		assert.equal(up.list[0].pvExpectedDayKwh, 20);
		assert.equal(up.list[0].id, first.id);
		assert.notEqual(changed.id, first.id);
	});
});
