import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidSoc, normalizeBatteryPowerW } from "./history";
import {
	computeBatteryRuntimeLearning,
	computeNightDischarges,
	computePowerStats,
	computeSocRates,
	computeTopoffStatus,
	estimateRuntimeDays,
	findLastFullCharge,
	noSourceResult,
} from "./math";
import { readBatteryRuntimePersist, writeBatteryRuntimePersist } from "./persist";
import { timestampAtLocalTime } from "./time";
import type { PowerPoint, SocPoint } from "./types";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const MS_H = 3_600_000;

function cfg() {
	return {
		enabled: true,
		lookbackDays: 90,
		socStateId: "",
		powerStateId: "",
		powerInvert: false,
		capacityStateId: "",
		fullChargeSoc: 95,
		topoffIntervalDays: 20,
		nightStart: "22:00",
		nightEnd: "06:00",
	};
}

function socAt(dateKey: string, hour: number, socPct: number): SocPoint {
	return {
		ts: timestampAtLocalTime(dateKey, hour, 0),
		socPct,
	};
}

describe("battery runtime validation", () => {
	it("ignores invalid soc and null power", () => {
		assert.equal(isValidSoc(null), false);
		assert.equal(isValidSoc(-1), false);
		assert.equal(isValidSoc(50), true);
		assert.equal(normalizeBatteryPowerW(null), null);
		assert.equal(normalizeBatteryPowerW(10), null);
		assert.equal(normalizeBatteryPowerW(500), 500);
		assert.equal(normalizeBatteryPowerW(-800), -800);
	});

	it("inverts power sign for sources like Sonnen pacTotal", () => {
		assert.equal(normalizeBatteryPowerW(2000, true), -2000);
		assert.equal(normalizeBatteryPowerW(-1500, true), 1500);
	});
});

describe("battery runtime night discharge", () => {
	it("computes average night discharge percent", () => {
		const points: SocPoint[] = [
			socAt("2026-01-05", 22, 80),
			socAt("2026-01-06", 6, 72),
			socAt("2026-01-06", 22, 78),
			socAt("2026-01-07", 6, 70),
		];
		const r = computeNightDischarges({
			socPoints: points,
			nightStart: "22:00",
			nightEnd: "06:00",
			capacityKwh: null,
		});
		assert.equal(r.validNights, 2);
		assert.equal(r.avgPct, 8);
		assert.equal(r.avgKwh, null);
	});

	it("computes kwh with capacity", () => {
		const points: SocPoint[] = [
			socAt("2026-01-05", 22, 80),
			socAt("2026-01-06", 6, 70),
		];
		const r = computeNightDischarges({
			socPoints: points,
			nightStart: "22:00",
			nightEnd: "06:00",
			capacityKwh: 10,
		});
		assert.equal(r.avgKwh, 1);
	});

	it("does not treat missing kwh as zero without capacity", () => {
		const r = computeNightDischarges({
			socPoints: [socAt("2026-01-05", 22, 80), socAt("2026-01-06", 6, 70)],
			nightStart: "22:00",
			nightEnd: "06:00",
			capacityKwh: null,
		});
		assert.equal(r.avgKwh, null);
	});
});

describe("battery runtime rates and power", () => {
	it("separates charge and discharge soc rates", () => {
		const points: SocPoint[] = [
			{ ts: 0, socPct: 50 },
			{ ts: MS_H, socPct: 55 },
			{ ts: 2 * MS_H, socPct: 52 },
		];
		const r = computeSocRates(points);
		assert.equal(r.avgChargeRatePctH, 5);
		assert.equal(r.avgDischargeRatePctH, 3);
	});

	it("computes max charge and discharge power", () => {
		const points: PowerPoint[] = [
			{ ts: 0, powerW: 2000 },
			{ ts: MS_H, powerW: -1500 },
			{ ts: 2 * MS_H, powerW: 3000 },
		];
		const r = computePowerStats(points);
		assert.equal(r.maxChargePowerW, 3000);
		assert.equal(r.maxDischargePowerW, 1500);
		assert.equal(r.avgChargePowerW, 2500);
		assert.equal(r.avgDischargePowerW, 1500);
	});
});

describe("battery runtime full charge and topoff", () => {
	it("detects last full charge", () => {
		const points: SocPoint[] = [
			{ ts: Date.parse("2026-01-01T10:00:00Z"), socPct: 90 },
			{ ts: Date.parse("2026-01-10T10:00:00Z"), socPct: 96 },
			{ ts: Date.parse("2026-01-11T10:00:00Z"), socPct: 92 },
		];
		assert.equal(findLastFullCharge(points, 95), "2026-01-10T10:00:00.000Z");
	});

	it("computes topoff remaining and due", () => {
		const now = new Date("2026-01-25T12:00:00Z");
		const r = computeTopoffStatus({
			lastFullCharge: "2026-01-01T12:00:00.000Z",
			topoffIntervalDays: 20,
			now,
		});
		assert.equal(r.daysSinceFull, 24);
		assert.equal(r.topoffDaysRemaining, 0);
		assert.equal(r.topoffDue, true);
	});

	it("returns null topoff without full charge history", () => {
		const r = computeTopoffStatus({
			lastFullCharge: null,
			topoffIntervalDays: 20,
			now: new Date(),
		});
		assert.equal(r.daysSinceFull, null);
		assert.equal(r.topoffDue, null);
	});
});

describe("battery runtime compute", () => {
	it("estimates runtime days from night discharge", () => {
		assert.equal(estimateRuntimeDays(80, 8), 10);
		assert.equal(estimateRuntimeDays(80, null), null);
	});

	it("no_source without soc mapping", () => {
		const r = noSourceResult(cfg());
		assert.equal(r.status, "no_source");
		assert.equal(r.avgNightDischargePct, null);
	});
});

describe("battery runtime persist", () => {
	it("roundtrips persist file", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-"));
		const points = [socAt("2026-01-05", 22, 80), socAt("2026-01-06", 6, 70)];
		const result = computeBatteryRuntimeLearning({
			socPoints: points,
			powerPoints: [],
			capacityKwh: 10,
			currentSocPct: 75,
			cfg: cfg(),
			sourceSocStateId: "sonnen.0.status.userSoc",
			sourcePowerStateId: "",
			now: new Date("2026-01-07T10:00:00"),
			sampleDays: 2,
		});
		await writeBatteryRuntimePersist(dir, result, "2026-01-07T10:00:00.000Z");
		const read = await readBatteryRuntimePersist(dir);
		assert.ok(read);
		assert.equal(read?.module, "battery_runtime_learning_v1");
	});
});
