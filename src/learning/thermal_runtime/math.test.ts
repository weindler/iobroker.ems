import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { configIsValid, thermalRuntimeConfigFromAdapter } from "./config";
import { isValidTempC } from "./history";
import {
	collectCoolingSegments,
	computeThermalRuntimeLearning,
	detectRuntimeCycles,
	estimateRemainingHours,
	estimateActiveCoolingRateCPerH,
	estimateCoolingConstantPerH,
	invalidConfigResult,
	noSourceResult,
} from "./math";
import { readThermalRuntimePersist, writeThermalRuntimePersist } from "./persist";
import type { TempPoint, ThermalRuntimeConfig } from "./types";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const MS_H = 3_600_000;

function cfg(overrides: Partial<ThermalRuntimeConfig> = {}): ThermalRuntimeConfig {
	return {
		enabled: true,
		lookbackDays: 90,
		temperatureStateId: "",
		fullThresholdC: 60,
		emptyThresholdC: 48,
		minRuntimeHours: 0.5,
		maxRuntimeHours: 72,
		...overrides,
	};
}

function coolingCurve(
	startMs: number,
	startTemp: number,
	endTemp: number,
	hours: number,
	steps = 6,
): TempPoint[] {
	const out: TempPoint[] = [];
	for (let i = 0; i <= steps; i++) {
		const frac = i / steps;
		out.push({
			ts: startMs + frac * hours * MS_H,
			tempC: startTemp + (endTemp - startTemp) * frac,
		});
	}
	return out;
}

describe("thermal runtime validation", () => {
	it("rejects null and NaN temperatures", () => {
		assert.equal(isValidTempC(null), false);
		assert.equal(isValidTempC(Number.NaN), false);
		assert.equal(isValidTempC(55.2), true);
	});

	it("rejects full <= empty config", () => {
		const c = cfg({ fullThresholdC: 48, emptyThresholdC: 60 });
		assert.equal(configIsValid(c), false);
		const r = invalidConfigResult("alias.0.temp");
		assert.equal(r.status, "invalid_config");
		assert.equal(r.health, "invalid_config");
	});
});

describe("thermal runtime cycle detection", () => {
	it("detects cooling from local peak down to floor (classic high start)", () => {
		const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
		const points = coolingCurve(base, 62, 47, 10);
		const cycles = detectRuntimeCycles(points, cfg());
		assert.equal(cycles.length, 1);
		assert.equal(cycles[0].startTempC, 62);
		assert.equal(cycles[0].endTempC, 47);
		assert.ok(cycles[0].runtimeHours >= 9.9 && cycles[0].runtimeHours <= 10.1);
		assert.ok(cycles[0].coolingRateCPerH > 1);
	});

	it("detects cooling when start is in band without reaching full threshold", () => {
		const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
		const points = coolingCurve(base, 55, 47, 8);
		const cycles = detectRuntimeCycles(points, cfg({ fullThresholdC: 60, emptyThresholdC: 48 }));
		assert.equal(cycles.length, 1);
		assert.equal(cycles[0].startTempC, 55);
		assert.ok(cycles[0].endTempC <= 48);
	});

	it("ignores incomplete segments that never reach floor", () => {
		const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
		const points = coolingCurve(base, 59, 52, 5);
		const cycles = detectRuntimeCycles(points, cfg());
		assert.equal(cycles.length, 0);
	});

	it("ignores cycles shorter than min_runtime_hours", () => {
		const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
		const points = coolingCurve(base, 62, 47, 0.2);
		const cycles = detectRuntimeCycles(points, cfg({ minRuntimeHours: 0.5 }));
		assert.equal(cycles.length, 0);
	});

	it("estimates an active cooling rate before the floor is reached", () => {
		const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
		// Läuft noch: 59 -> 55 °C in 48h, Untergrenze 48 °C noch nicht erreicht.
		const points = coolingCurve(base, 59, 55, 48, 8);
		const rate = estimateActiveCoolingRateCPerH(points, cfg());
		assert.equal(rate, 0.083);
		assert.equal(detectRuntimeCycles(points, cfg()).length, 0);
	});

	it("ignores reheating plateaus — rate stays the natural cooldown, not the mixed trend", () => {
		const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
		// Echtes Abkühlen 58->54 in 8h (0.5 °C/h), dann Nachheizen zurück auf 58,
		// dann langes Plateau. Mischtrend wäre viel flacher als 0.5.
		const cooling = coolingCurve(base, 58, 54, 8, 8);
		const reheatStart = cooling[cooling.length - 1].ts;
		const reheat = coolingCurve(reheatStart, 54, 58, 4, 4);
		const plateauStart = reheat[reheat.length - 1].ts;
		const plateau: TempPoint[] = [];
		for (let h = 1; h <= 40; h++) {
			plateau.push({ ts: plateauStart + h * MS_H, tempC: 58 - 0.1 });
		}
		const points = [...cooling, ...reheat, ...plateau];
		const rate = estimateActiveCoolingRateCPerH(points, cfg());
		assert.ok(rate !== null && rate >= 0.45 && rate <= 0.55, `rate=${rate}`);
	});

	it("collects multiple cooling segments and uses their median rate", () => {
		const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
		const seg1 = coolingCurve(base, 58, 53, 10, 10); // 0.5 °C/h
		const gapStart = seg1[seg1.length - 1].ts;
		const reheat = coolingCurve(gapStart, 53, 59, 3, 6); // Nachheizen
		const seg2Start = reheat[reheat.length - 1].ts;
		const seg2 = coolingCurve(seg2Start, 59, 51, 8, 8); // 1.0 °C/h
		const points = [...seg1, ...reheat, ...seg2];
		const segments = collectCoolingSegments(points, cfg().minRuntimeHours);
		assert.equal(segments.length, 2);
		const rate = estimateActiveCoolingRateCPerH(points, cfg());
		assert.ok(rate !== null && rate >= 0.7 && rate <= 0.8, `rate=${rate}`);
	});
});

describe("thermal runtime remaining estimate", () => {
	it("returns 0 when at or below empty threshold", () => {
		assert.equal(estimateRemainingHours({
			currentTempC: 48,
			fullThresholdC: 60,
			emptyThresholdC: 48,
			typicalRuntimeHours: 12,
			coolingRateCPerHAvg: 1.2,
		}), 0);
	});

	it("uses cooling rate from current temp (not fixed full threshold)", () => {
		const h = estimateRemainingHours({
			currentTempC: 59,
			fullThresholdC: 60,
			emptyThresholdC: 48,
			typicalRuntimeHours: 14,
			coolingRateCPerHAvg: 2,
		});
		assert.equal(h, 5.5);
	});

	it("interpolates via cooling rate between thresholds", () => {
		const h = estimateRemainingHours({
			currentTempC: 54,
			fullThresholdC: 60,
			emptyThresholdC: 48,
			typicalRuntimeHours: 14,
			coolingRateCPerHAvg: 2,
		});
		assert.equal(h, 3);
	});

	it("returns null without sufficient learned rate", () => {
		assert.equal(estimateRemainingHours({
			currentTempC: 54,
			fullThresholdC: 60,
			emptyThresholdC: 48,
			typicalRuntimeHours: null,
			coolingRateCPerHAvg: null,
		}), null);
	});

	it("uses Newtonian cooling when a cooling constant is provided", () => {
		// t = ln((58-18)/(48-18)) / k = ln(40/30)/0.05 = 5.754 h
		const h = estimateRemainingHours({
			currentTempC: 58,
			fullThresholdC: 60,
			emptyThresholdC: 48,
			typicalRuntimeHours: null,
			coolingRateCPerHAvg: null,
			coolingConstantPerH: 0.05,
			ambientC: 18,
		});
		assert.ok(h !== null && Math.abs(h - 5.754) < 0.01, `h=${h}`);
	});

	it("Newtonian: cooling slows as the buffer approaches ambient", () => {
		const common = {
			fullThresholdC: 60,
			emptyThresholdC: 48,
			typicalRuntimeHours: null,
			coolingRateCPerHAvg: null,
			coolingConstantPerH: 0.05,
			ambientC: 18,
		};
		const r58 = estimateRemainingHours({ ...common, currentTempC: 58 })!;
		const r53 = estimateRemainingHours({ ...common, currentTempC: 53 })!;
		// Die ersten 5 °C (58→53) gehen schneller als die letzten 5 °C (53→48).
		assert.ok(r58 - r53 < r53, `first5=${r58 - r53} last5=${r53}`);
	});
});

describe("thermal newtonian cooling constant", () => {
	it("derives a positive cooling constant from a falling segment", () => {
		const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
		// 58 → 48 °C über 10 h → k = ln((58-18)/(48-18))/10 ≈ 0.02877 /h
		const points = coolingCurve(base, 58, 48, 10, 10);
		const k = estimateCoolingConstantPerH(points, cfg(), 18);
		assert.ok(k !== null && Math.abs(k - 0.02877) < 0.002, `k=${k}`);
	});

	it("returns null when no falling segment qualifies", () => {
		const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
		const points = coolingCurve(base, 55, 54.5, 5, 5); // <2 °C Abfall
		assert.equal(estimateCoolingConstantPerH(points, cfg(), 18), null);
	});
});

describe("thermal runtime compute", () => {
	it("reports no_samples without cycles", () => {
		const r = computeThermalRuntimeLearning({
			cycles: [],
			currentTempC: 55,
			cfg: cfg(),
			sourceStateId: "alias.0.temp",
			now: new Date("2026-06-21T10:00:00"),
		});
		assert.equal(r.status, "insufficient_data");
		assert.equal(r.health, "no_samples");
		assert.equal(r.samples, 0);
		assert.equal(r.estimatedRemainingHours, null);
	});

	it("uses active cooling rate for provisional remaining estimate without completed cycles", () => {
		const r = computeThermalRuntimeLearning({
			cycles: [],
			currentTempC: 55,
			cfg: cfg(),
			sourceStateId: "alias.0.temp",
			now: new Date("2026-06-21T10:00:00"),
			activeCoolingRateCPerH: 0.1,
		});
		assert.equal(r.status, "insufficient_data");
		assert.equal(r.health, "no_samples");
		assert.equal(r.samples, 0);
		assert.equal(r.estimatedRemainingHours, 70);
		assert.equal(r.estimatedEmptyAt, "2026-06-24T06:00:00.000Z");
	});

	it("no_source result", () => {
		const r = noSourceResult();
		assert.equal(r.health, "no_source");
		assert.equal(r.samples, 0);
	});
});

describe("thermal runtime config", () => {
	it("reads admin defaults", () => {
		const c = thermalRuntimeConfigFromAdapter({});
		assert.equal(c.fullThresholdC, 60);
		assert.equal(c.emptyThresholdC, 48);
		assert.equal(c.enabled, true);
	});
});

describe("thermal runtime persist", () => {
	it("roundtrips persist file", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tr-"));
		const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
		const cycles = detectRuntimeCycles(coolingCurve(base, 62, 47, 10), cfg());
		const result = computeThermalRuntimeLearning({
			cycles,
			currentTempC: 55,
			cfg: cfg(),
			sourceStateId: "alias.0.temp",
			now: new Date("2026-06-21T10:00:00"),
		});
		await writeThermalRuntimePersist(dir, result, "2026-06-21T10:00:00.000Z");
		const read = await readThermalRuntimePersist(dir);
		assert.ok(read);
		assert.equal(read?.module, "thermal_runtime_learning_v1");
		assert.equal(read?.samples, 1);
	});
});
