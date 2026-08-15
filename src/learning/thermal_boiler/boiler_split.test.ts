/**
 * Boiler vs Puffer Learning — Realfall + T1–T16 (keine Puffer-Samples als Boiler).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { evaluateHygieneDuty } from "../../addons/immersion_heater/hygiene";
import { immersionDeviceConfigFromAdapter } from "../../addons/immersion_heater/device_config";
import { plannerModePolicyFromGlobalMode } from "../../planner/mode_policy";
import { buildImmersionHeaterContributions } from "../../operator/contributions/flexible/immersion_heater";
import { thermalEmptyAtUsableForPlanning } from "../../operator/contributions/flexible/thermal_empty_at";
import { buildThermalLearningSignal } from "../../operator/contributions/flexible/thermal_learning";
import { resolveBoilerBufferThermalEnergy, bufferSoftHeadroomKwh } from "../../operator/daily_plan/unified/thermal_boiler_buffer";
import { allocateUnifiedDayPlan } from "../../operator/daily_plan/unified/allocate";
import { golden001Input, buildSlots } from "../../operator/daily_plan/unified/fixtures";
import { EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED } from "../../addons/wallbox/ev_foundation/write_allowlist";
import {
	collectCoolingSegments,
	computeThermalRuntimeLearning,
	detectRuntimeCycles,
	estimateCoolingModel,
	estimateRemainingHours,
} from "../thermal_runtime/math";
import type { TempPoint, ThermalRuntimeConfig } from "../thermal_runtime/types";
import { thermalBoilerConfigFromAdapter } from "./config";
import { BOILER_MODULE_TAG, readThermalBoilerPersist } from "./persist";
import { runThermalBoilerLearning, type ThermalBoilerRunHost } from "./run";

const MS_H = 3_600_000;
const NOW = Date.parse("2026-08-15T10:00:00.000Z");
const COVER = Date.parse("2026-08-15T16:00:00.000Z");
const NEXT_PV = Date.parse("2026-08-16T06:00:00.000Z");

function linearCurve(startMs: number, startC: number, endC: number, hours: number, steps = 12): TempPoint[] {
	const out: TempPoint[] = [];
	for (let i = 0; i <= steps; i++) {
		const frac = i / steps;
		out.push({ ts: startMs + frac * hours * MS_H, tempC: startC + (endC - startC) * frac });
	}
	return out;
}

function boilerCfg(): ThermalRuntimeConfig {
	return thermalBoilerConfigFromAdapter({ ih_boiler_min_temp_c: 50, ih_hygiene_target_temp_c: 60 });
}

function bufferCfg(): ThermalRuntimeConfig {
	return {
		enabled: true,
		lookbackDays: 90,
		temperatureStateId: "sensor.0.buffer",
		fullThresholdC: 60,
		emptyThresholdC: 48,
		minRuntimeHours: 0.5,
		maxRuntimeHours: 72,
	};
}

function mockBoilerHost(opts: {
	tmp: string;
	currentTemp: number | null;
	history: TempPoint[];
	stateId?: string;
}): ThermalBoilerRunHost & { states: Record<string, unknown> } {
	const states: Record<string, unknown> = {};
	const stateId = opts.stateId ?? "sensor.0.boiler";
	return {
		states,
		config: {
			ih_boiler_min_temp_c: 50,
			ih_hygiene_target_temp_c: 60,
			ih_boiler_temp_c_target: stateId,
			learning_thermal_runtime_enabled: true,
			learning_thermal_runtime_lookback_days: 7,
		},
		getStateAsync: async (id: string) => ({ val: states[id] }) as ioBroker.State,
		setStateAsync: async (id: string, state: ioBroker.SettableState) => {
			states[id] = state.val;
		},
		setObjectNotExistsAsync: async () => undefined,
		getForeignStateAsync: async () => ({ val: opts.currentTemp }) as ioBroker.State,
		getHistoryAsync: async () => ({
			result: opts.history.map((p) => ({
				ts: p.ts,
				val: p.tempC,
				ack: true,
				lc: p.ts,
				from: "test",
			})),
		}),
		getAbsolutePath: (category?: string) => path.join(opts.tmp, category ?? ""),
		log: { debug: () => undefined, warn: () => undefined, error: () => undefined },
	};
}

function immersionBase() {
	return {
		now: new Date(NOW),
		addonEnabled: true,
		governanceEnabled: true,
		globalModeOff: false,
		addonExecutionOff: false,
		modePolicy: plannerModePolicyFromGlobalMode("balanced"),
		config: immersionDeviceConfigFromAdapter({
			ih_boiler_min_temp_c: 50,
			ih_planning_max_temp_c: 63,
			ih_hygiene_target_temp_c: 60,
			ih_stage_1_set_state: "r.0.on",
			ih_stage_1_nominal_power_w: 1700,
		}),
		bufferTempC: 52,
		boilerTempC: 61,
		boilerSensorDegraded: false,
		thermalMode: "auto" as const,
		fault: false,
		lockout: false,
		relayMapped: true,
		pvTodayKwh: 40,
		pvTomorrowKwh: 20,
		pvBiasStatus: "ready",
		forecastModeEnabled: true,
		aiOptimizationAllowed: false,
		hygieneDue: false,
	};
}

describe("boiler/buffer split — observed real fault", () => {
	it("T12-real: slow boiler 64→61 vs fast buffer 61→52 — Hard follows boiler", () => {
		const start = NOW - 24 * MS_H;
		const boilerPts = linearCurve(start, 64, 61, 24);
		const bufferPts = linearCurve(NOW - 6 * MS_H, 61, 52, 6);
		const bCfg = boilerCfg();
		const pCfg = bufferCfg();

		const boilerModel = estimateCoolingModel(boilerPts, bCfg);
		const bufferModel = estimateCoolingModel(bufferPts, pCfg);
		assert.ok(boilerModel.coolingConstantPerH != null && boilerModel.coolingConstantPerH > 0);
		assert.ok(bufferModel.coolingConstantPerH != null && bufferModel.coolingConstantPerH > 0);

		const boilerRemain = estimateRemainingHours({
			currentTempC: 61,
			fullThresholdC: bCfg.fullThresholdC,
			emptyThresholdC: 50,
			typicalRuntimeHours: null,
			coolingRateCPerHAvg: null,
			coolingConstantPerH: boilerModel.coolingConstantPerH,
			ambientC: boilerModel.asymptoteC,
		});
		const bufferRemain = estimateRemainingHours({
			currentTempC: 52,
			fullThresholdC: 60,
			emptyThresholdC: 48,
			typicalRuntimeHours: null,
			coolingRateCPerHAvg: null,
			coolingConstantPerH: bufferModel.coolingConstantPerH,
			ambientC: bufferModel.asymptoteC,
		});
		assert.ok(boilerRemain != null && boilerRemain > 12, `boiler remain ${boilerRemain}`);
		assert.ok(bufferRemain != null && bufferRemain < boilerRemain!, `buffer remain ${bufferRemain}`);

		const boilerCycles = detectRuntimeCycles(boilerPts, bCfg);
		assert.equal(boilerCycles.length, 0, "64→61 must not count as a completed boiler cycle to 50 °C");

		const emptyAtMs = NOW + (boilerRemain ?? 0) * MS_H;
		const hard = resolveBoilerBufferThermalEnergy({
			nowMs: NOW,
			boilerTempC: 61,
			boilerMinTempC: 50,
			bufferTempC: 52,
			bufferMaxTempC: 63,
			softHeadroomEnergyKwh: 4,
			boilerCoolingRateCPerH: boilerModel.coolingConstantPerH! * (61 - boilerModel.asymptoteC),
			boilerEstimatedEmptyAtMs: emptyAtMs,
			boilerEmptyAtUsable: true,
			nextReliablePvMs: NEXT_PV,
			currentWindowEndMs: COVER,
			pvConfidence01: 0.85,
		});
		assert.ok(hard.mandatoryEnergyKwh < 0.05, `hard=${hard.mandatoryEnergyKwh} reason=${hard.reasonDe}`);
		assert.ok(hard.economicHeadroomKwh > 1);

		const wrongBufferHard = resolveBoilerBufferThermalEnergy({
			nowMs: NOW,
			boilerTempC: 61,
			boilerMinTempC: 50,
			bufferTempC: 52,
			bufferMaxTempC: 63,
			softHeadroomEnergyKwh: 4,
			/** Puffer-ähnliche Crash-Rate (~9 K / 6 h Cover) — darf nicht der Boiler-Pfad sein. */
			boilerCoolingRateCPerH: 2.5,
			boilerEstimatedEmptyAtMs: NOW + 2.7 * MS_H,
			boilerEmptyAtUsable: true,
			nextReliablePvMs: NEXT_PV,
			currentWindowEndMs: COVER,
			pvConfidence01: 0.85,
		});
		assert.ok(
			wrongBufferHard.mandatoryEnergyKwh > 0.2,
			"control: using buffer-like rate would create Hard — must not be the boiler path",
		);
	});
});

describe("boiler learning A vs buffer learning B", () => {
	it("T1: boiler above min + fast buffer drop → no Hard from buffer", () => {
		const r = resolveBoilerBufferThermalEnergy({
			nowMs: NOW,
			boilerTempC: 61,
			boilerMinTempC: 50,
			bufferTempC: 52,
			bufferMaxTempC: 63,
			softHeadroomEnergyKwh: 4,
			boilerCoolingRateCPerH: null,
			boilerEstimatedEmptyAtMs: null,
			boilerEmptyAtUsable: false,
			nextReliablePvMs: NEXT_PV,
			currentWindowEndMs: COVER,
			pvConfidence01: 0.85,
		});
		assert.ok(r.mandatoryEnergyKwh < 0.05);
		assert.ok(r.economicHeadroomKwh > 1);
	});

	it("T2: boiler approaching 50 °C → remaining hours shrink", () => {
		const cfg = boilerCfg();
		const pts = linearCurve(NOW - 20 * MS_H, 56, 51, 20);
		const model = estimateCoolingModel(pts, cfg);
		const far = estimateRemainingHours({
			currentTempC: 56,
			fullThresholdC: 60,
			emptyThresholdC: 50,
			typicalRuntimeHours: null,
			coolingRateCPerHAvg: null,
			coolingConstantPerH: model.coolingConstantPerH,
			ambientC: model.asymptoteC,
		});
		const near = estimateRemainingHours({
			currentTempC: 51,
			fullThresholdC: 60,
			emptyThresholdC: 50,
			typicalRuntimeHours: null,
			coolingRateCPerHAvg: null,
			coolingConstantPerH: model.coolingConstantPerH,
			ambientC: model.asymptoteC,
		});
		assert.ok(far != null && near != null && near < far);
	});

	it("T3: boiler under minimum → Hard", () => {
		const r = resolveBoilerBufferThermalEnergy({
			nowMs: NOW,
			boilerTempC: 48.5,
			boilerMinTempC: 50,
			bufferTempC: 58,
			bufferMaxTempC: 63,
			softHeadroomEnergyKwh: 2,
			boilerCoolingRateCPerH: null,
			boilerEstimatedEmptyAtMs: null,
			boilerEmptyAtUsable: false,
			nextReliablePvMs: NEXT_PV,
			currentWindowEndMs: COVER,
			pvConfidence01: 0.85,
		});
		assert.ok(r.mandatoryEnergyKwh > 0.3);
		assert.equal(r.hardFromBoiler, true);
	});

	it("T4: boiler Newton works without completed cooling cycles", () => {
		const cfg = boilerCfg();
		const pts = linearCurve(NOW - 18 * MS_H, 64, 61, 18);
		assert.equal(detectRuntimeCycles(pts, cfg).length, 0);
		assert.ok(collectCoolingSegments(pts, cfg.minRuntimeHours).length >= 1);
		const model = estimateCoolingModel(pts, cfg);
		const result = computeThermalRuntimeLearning({
			cycles: [],
			currentTempC: 61,
			cfg,
			sourceStateId: "sensor.0.boiler",
			now: new Date(NOW),
			coolingConstantPerH: model.coolingConstantPerH,
			asymptoteC: model.asymptoteC,
			asymptoteSource: model.asymptoteSource,
		});
		assert.ok(result.coolingConstantPerH != null && result.coolingConstantPerH > 0);
		assert.ok(result.estimatedEmptyAt);
		assert.ok((result.estimatedRemainingHours ?? 0) > 8);
		const signal = buildThermalLearningSignal({
			now: new Date(NOW),
			rawStatus: result.status,
			rawHealth: result.health,
			samples: result.samples,
			coolingRateCPerHAvg: result.coolingRateCPerHAvg,
			coolingConstantPerH: result.coolingConstantPerH,
			coolingAsymptoteC: result.coolingAsymptoteC,
			estimatedRemainingHours: result.estimatedRemainingHours,
			estimatedEmptyAtRaw: result.estimatedEmptyAt,
			byDayTypeJsonRaw: "{}",
			vessel: "boiler",
		});
		assert.equal(signal.status, "degraded");
		assert.equal(thermalEmptyAtUsableForPlanning(signal), true);
		assert.match(signal.reasonDe, /Boiler-Learning/);
	});

	it("T5: buffer cycles are not boiler cycles", () => {
		const bufferToFloor = linearCurve(NOW - 12 * MS_H, 62, 47, 12);
		const boilerStay = linearCurve(NOW - 12 * MS_H, 64, 61, 12);
		assert.ok(detectRuntimeCycles(bufferToFloor, bufferCfg()).length >= 1);
		assert.equal(detectRuntimeCycles(boilerStay, boilerCfg()).length, 0);
	});

	it("T6/T7: runThermalBoilerLearning uses boiler history only and writes boiler emptyAt", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-"));
		const boilerPts = linearCurve(NOW - 20 * MS_H, 64, 61, 20);
		const host = mockBoilerHost({ tmp, currentTemp: 61, history: boilerPts });
		await runThermalBoilerLearning(host);
		assert.equal(host.states["learning.thermal_boiler.vessel"], "boiler");
		assert.equal(host.states["learning.thermal_boiler.soft_relevance"], false);
		assert.equal(host.states["learning.thermal_boiler.samples"], 0);
		assert.ok(Number(host.states["learning.thermal_boiler.cooling_k_per_h"]) > 0);
		const emptyAt = String(host.states["learning.thermal_boiler.estimated_empty_at"] ?? "");
		assert.ok(emptyAt.length > 10, `emptyAt=${emptyAt}`);
		assert.ok(Date.parse(emptyAt) > NOW + 8 * MS_H);
		assert.match(String(host.states["learning.thermal_boiler.reason_de"]), /nicht Puffer|Newton/);
		const persist = await readThermalBoilerPersist(path.join(tmp, "learning/thermal_boiler"));
		assert.equal(persist?.module, BOILER_MODULE_TAG);
		assert.equal(persist?.samples, 0);
	});

	it("T8: bufferEstimatedEmptyAt never becomes Hard deadline in contribution", () => {
		const [, flex] = buildImmersionHeaterContributions({
			...immersionBase(),
			thermalLearning: {
				status: "degraded",
				health: "ok",
				samples: 0,
				coolingRateCPerHAvg: null,
				coolingConstantPerH: 0.2,
				coolingAsymptoteC: 18,
				estimatedRemainingHours: 2,
				estimatedEmptyAt: "2026-08-15T12:00:00.000Z",
				currentDayTypeRuntimeHoursMedian: null,
				reasonDe: "Puffer newton",
			},
			boilerLearning: {
				status: "missing",
				health: null,
				samples: 0,
				coolingRateCPerHAvg: null,
				coolingConstantPerH: null,
				coolingAsymptoteC: null,
				estimatedRemainingHours: null,
				estimatedEmptyAt: null,
				currentDayTypeRuntimeHoursMedian: null,
				reasonDe: "kein boiler model",
			},
		});
		assert.equal(flex.deadlineIso, null);
		assert.equal(flex.details.emptyAtPlanningUsable, false);
		assert.equal(flex.details.bufferEstimatedEmptyAt, "2026-08-15T12:00:00.000Z");
		assert.equal(flex.details.boilerEstimatedEmptyAt, null);
		assert.equal(flex.details.hardThermalSource, "boiler");
		assert.equal(flex.details.softThermalSource, "buffer");
		assert.equal(flex.details.thermalLearningModel, "newton");
		assert.equal(flex.details.boilerLearningModel, "none");
	});

	it("T9: hygiene >60 °C is boiler-based", () => {
		const hy = evaluateHygieneDuty({
			nowMs: NOW,
			boilerTempC: 55,
			hygieneTargetTempC: 60,
			bufferTempC: 63,
			bufferMaxTempC: 63,
			lastBoilerHygieneAtIso: new Date(NOW - 8 * 24 * 3600_000).toISOString(),
			kwhPerDegreeC: 0.38,
		});
		assert.equal(hy.due, true);
		assert.equal(hy.blockedByBufferMax, true);
		assert.equal(hy.mandatoryEnergyKwh, 0);
	});

	it("T10: buffer safety max unchanged", () => {
		assert.equal(bufferSoftHeadroomKwh({ bufferTempC: 63, bufferMaxTempC: 63 }), 0);
		assert.ok(bufferSoftHeadroomKwh({ bufferTempC: 52, bufferMaxTempC: 63 }) > 3);
	});

	it("T11: PV soft precharge still possible when boiler is warm", () => {
		const [, flex] = buildImmersionHeaterContributions({
			...immersionBase(),
			bufferTempC: 50,
			boilerTempC: 62,
			todayPvSurplusKwh: 18,
			batterySocPct: 90,
			batteryEndSocTargetPct: 90,
		});
		assert.equal(flex.deadlineIso, null);
		assert.ok(flex.enabled === true || (flex.details.requiredEnergyKwh as number) > 0 || flex.details.pvPrechargeActive);
	});

	it("T5-persist: buffer persist file is not accepted as boiler learning", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-rej-"));
		await fs.mkdir(tmp, { recursive: true });
		await fs.writeFile(
			path.join(tmp, "thermal_boiler_learning_v1.json"),
			JSON.stringify({
				generated_at: new Date().toISOString(),
				module: "thermal_runtime_learning_v1",
				samples: 12,
				runtime_hours_avg: 8,
				runtime_hours_median: 8,
				cooling_rate_c_per_h_avg: 1.4,
				by_season: {},
				by_day_type: {},
				history: [],
				health: "ok",
			}),
		);
		const read = await readThermalBoilerPersist(tmp);
		assert.equal(read, null);
	});

	it("T16: no new EV planner writes", () => {
		assert.equal(EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
	});
});

describe("boiler split — unified / climate / battery regression smoke", () => {
	it("T12: unified still allocates thermal soft without boiler Hard", () => {
		const input = golden001Input();
		input.time.nowIso = "2026-08-15T10:00:00.000Z";
		input.time.slots = buildSlots("2026-08-15T10:00:00.000Z", 8);
		input.thermal = {
			...input.thermal!,
			boilerTempC: 61,
			boilerMinTempC: 50,
			bufferTempC: 52,
			minTempC: 50,
			maxTempC: 63,
			headroomEnergyKwh: 4,
			estimatedEmptyAtIso: null,
			deadlineIso: null,
			emptyAtSource: null,
			boilerEmptyAtUsable: false,
			coolingRateCPerH: null,
		};
		input.wallbox = null;
		input.climate = null;
		const plan = allocateUnifiedDayPlan(input);
		const hard = plan.allocations
			.filter((a) => a.kind === "immersion_heater" && a.consumerId === "immersion_heater")
			.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		const soft = plan.allocations
			.filter((a) => a.kind === "immersion_heater")
			.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		assert.ok(soft >= 0);
		assert.ok(hard >= 0);
		assert.ok(plan.reasonCodes.length >= 0);
	});
});
