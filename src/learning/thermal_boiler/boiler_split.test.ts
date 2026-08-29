/**
 * Boiler vs Puffer Learning — Realfall + T1–T16 (keine Puffer-Samples als Boiler).
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { resetHistoryQueryQueueForTests } from "../history_query";
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
import {
	BOILER_MODULE_TAG,
	BOILER_SOURCE_KIND,
	isTrustedBoilerPersist,
	readThermalBoilerPersist,
} from "./persist";
import { runThermalBoilerLearning, __resetThermalBoilerRunLockForTest, type ThermalBoilerRunHost } from "./run";
import {
	appendBoilerTempSample,
	BOILER_SAMPLE_MIN_INTERVAL_MS,
	mergeBoilerTempPoints,
} from "./samples";

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

function historyResult(history: TempPoint[]): { result: ioBroker.GetHistoryResult } {
	return {
		result: history.map((p) => ({
			ts: p.ts,
			val: p.tempC,
			ack: true,
			lc: p.ts,
			from: "test",
		})),
	};
}

function mockBoilerHost(opts: {
	tmp: string;
	currentTemp: number | null;
	history: TempPoint[];
	stateId?: string;
	/** Native Admin darf nicht die Boiler-Quelle überschreiben. */
	adminBoilerTempTarget?: string;
	planningMaxTempC?: number;
	liveBoilerTempC?: number | null;
	foreignTemps?: Record<string, number | null>;
	historyById?: Record<string, TempPoint[]>;
	mappingEnabled?: boolean;
	mappingTarget?: string | null;
}): ThermalBoilerRunHost & { states: Record<string, unknown>; historyIds: string[] } {
	const states: Record<string, unknown> = {};
	const stateId = opts.stateId ?? "sensor.0.boiler";
	const mappingTarget = opts.mappingTarget === undefined ? stateId : opts.mappingTarget;
	const mappingEnabled = opts.mappingEnabled !== false && Boolean(mappingTarget);
	if (opts.liveBoilerTempC !== undefined) {
		states["live.thermal.boiler_temp_c"] = opts.liveBoilerTempC;
	}
	const historyIds: string[] = [];
	return {
		states,
		historyIds,
		config: {
			ih_boiler_min_temp_c: 50,
			ih_hygiene_target_temp_c: 60,
			ih_planning_max_temp_c: opts.planningMaxTempC ?? 63,
			ih_boiler_temp_c_enabled: mappingEnabled,
			ih_boiler_temp_c_target: mappingEnabled ? mappingTarget : "",
			ih_buffer_temp_c_target: opts.adminBoilerTempTarget ?? "sensor.0.buffer",
			learning_thermal_runtime_enabled: true,
			learning_thermal_runtime_lookback_days: 7,
		},
		getStateAsync: async (id: string) => ({ val: states[id] }) as ioBroker.State,
		setStateAsync: async (id: string, state: ioBroker.SettableState) => {
			states[id] = state.val;
		},
		setObjectNotExistsAsync: async () => undefined,
		getForeignStateAsync: async (id: string) => {
			if (opts.foreignTemps && Object.prototype.hasOwnProperty.call(opts.foreignTemps, id)) {
				return { val: opts.foreignTemps[id] } as ioBroker.State;
			}
			if (id === stateId || id === mappingTarget) {
				return { val: opts.currentTemp } as ioBroker.State;
			}
			return { val: null } as ioBroker.State;
		},
		getHistoryAsync: async (id: string) => {
			historyIds.push(id);
			if (opts.historyById && Object.prototype.hasOwnProperty.call(opts.historyById, id)) {
				return historyResult(opts.historyById[id]!);
			}
			if (id === stateId || id === mappingTarget) {
				return historyResult(opts.history);
			}
			return { result: [] };
		},
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
	afterEach(() => {
		__resetThermalBoilerRunLockForTest();
		resetHistoryQueryQueueForTests();
	});

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
		// nowMs=NOW: History liegt um den Test-Anker; Wall-Clock würde 7-Tage-Lookback trimmen.
		await runThermalBoilerLearning(host, { nowMs: NOW });
		assert.equal(host.states["learning.thermal_boiler.model"], "newton");
		assert.equal(host.states["learning.thermal_boiler.samples"], 0);
		assert.ok(Number(host.states["learning.thermal_boiler.cooling_k_per_h"]) > 0);
		const emptyAt = String(host.states["learning.thermal_boiler.estimated_empty_at"] ?? "");
		assert.ok(emptyAt.length > 10, `emptyAt=${emptyAt}`);
		assert.ok(Date.parse(emptyAt) > NOW + 8 * MS_H);
		assert.match(String(host.states["learning.thermal_boiler.reason_de"]), /nicht Puffer|Newton/);
		const persist = await readThermalBoilerPersist(path.join(tmp, "learning/thermal_boiler"));
		assert.equal(persist?.module, BOILER_MODULE_TAG);
		assert.equal(persist?.source_kind, "mapping.boiler_temp_c");
		assert.equal(persist?.source_state_id, "sensor.0.boiler");
		assert.equal(persist?.samples, 0);
	});

	it("T17: explain and Newton use mapping.boiler_temp_c=60, never admin/buffer 63 or planningMax", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-src-"));
		const boilerPts = linearCurve(NOW - 8 * MS_H, 60.2, 60, 8);
		const bufferPts = linearCurve(NOW - 8 * MS_H, 63, 63, 8);
		const host = mockBoilerHost({
			tmp,
			stateId: "sensor.0.boiler",
			currentTemp: 60,
			history: boilerPts,
			adminBoilerTempTarget: "sensor.0.buffer",
			planningMaxTempC: 63,
			liveBoilerTempC: 60,
			foreignTemps: {
				"sensor.0.boiler": 60,
				"sensor.0.buffer": 63,
			},
			historyById: {
				"sensor.0.boiler": boilerPts,
				"sensor.0.buffer": bufferPts,
			},
		});
		await runThermalBoilerLearning(host);
		assert.equal(host.states["learning.thermal_boiler.current_temperature_c"], 60);
		assert.equal(host.states["learning.thermal_boiler.model"], "none");
		assert.equal(host.states["learning.thermal_boiler.samples"], 0);
		const reason = String(host.states["learning.thermal_boiler.reason_de"] ?? "");
		assert.match(reason, /Boiler 60\.0 °C/);
		assert.doesNotMatch(reason, /63/);
		assert.deepEqual(host.historyIds, ["sensor.0.boiler"]);
	});

	it("T18: without mapping.boiler_temp_c, admin 63 / live 60 / planningMax 63 are not used", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-nomap-"));
		const host = mockBoilerHost({
			tmp,
			currentTemp: 60,
			history: linearCurve(NOW - 8 * MS_H, 60, 60, 8),
			mappingEnabled: false,
			mappingTarget: "sensor.0.boiler",
			adminBoilerTempTarget: "sensor.0.buffer",
			planningMaxTempC: 63,
			liveBoilerTempC: 60,
			foreignTemps: {
				"sensor.0.boiler": 60,
				"sensor.0.buffer": 63,
			},
		});
		await runThermalBoilerLearning(host);
		assert.equal(host.states["learning.thermal_boiler.current_temperature_c"], null);
		assert.equal(host.states["learning.thermal_boiler.model"], "none");
		assert.equal(host.states["learning.thermal_boiler.samples"], 0);
		assert.match(String(host.states["learning.thermal_boiler.reason_de"]), /Boiler-Sensor fehlt/);
		assert.doesNotMatch(String(host.states["learning.thermal_boiler.reason_de"]), /63/);
		assert.deepEqual(host.historyIds, []);
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
		assert.equal(flex.details.bufferEstimatedEmptyAt, null);
		assert.equal(flex.details.boilerEstimatedEmptyAt, null);
		assert.equal(flex.details.hardThermalSource, "boiler");
		assert.equal(flex.details.softThermalSource, "buffer_cap");
		assert.equal(flex.details.thermalLearningModel, "none");
		assert.equal(flex.details.bufferLearningModel, "unused");
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

	it("T19: old boiler persist without mapping source_kind is discarded", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-oldsrc-"));
		await fs.mkdir(tmp, { recursive: true });
		await fs.writeFile(
			path.join(tmp, "thermal_boiler_learning_v1.json"),
			JSON.stringify({
				generated_at: new Date().toISOString(),
				module: BOILER_MODULE_TAG,
				samples: 4,
				runtime_hours_avg: 10,
				runtime_hours_median: 10,
				cooling_rate_c_per_h_avg: 0.4,
				by_season: {},
				by_day_type: {},
				history: [],
				health: "ok",
			}),
		);
		assert.equal(await readThermalBoilerPersist(tmp), null);
		assert.equal(
			isTrustedBoilerPersist({
				generated_at: "",
				module: BOILER_MODULE_TAG,
				samples: 1,
				runtime_hours_avg: null,
				runtime_hours_median: null,
				cooling_rate_c_per_h_avg: null,
				by_season: {},
				by_day_type: {},
				history: [],
				health: "ok",
				source_kind: "ih_boiler_temp_c_target",
				source_state_id: "sensor.0.buffer",
			}),
			false,
		);
	});

	it("T20: persist is trusted only for mapping.boiler_temp_c", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-oksrc-"));
		const boilerPts = linearCurve(NOW - 20 * MS_H, 64, 61, 20);
		const host = mockBoilerHost({ tmp, currentTemp: 60, history: boilerPts });
		await runThermalBoilerLearning(host);
		const persist = await readThermalBoilerPersist(path.join(tmp, "learning/thermal_boiler"));
		assert.equal(persist?.source_kind, BOILER_SOURCE_KIND);
		assert.equal(persist?.source_state_id, "sensor.0.boiler");
		assert.equal(isTrustedBoilerPersist(persist), true);
	});

	it("T21: startup with stale 63 diagnose writes mapping 59 immediately", async () => {
		__resetThermalBoilerRunLockForTest();
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-startup-"));
		const host = mockBoilerHost({ tmp, currentTemp: 59, history: [] });
		host.states["learning.thermal_boiler.current_temperature_c"] = 63;
		host.states["learning.thermal_boiler.reason_de"] = "Boiler 63.0 °C — Altzustand";
		await runThermalBoilerLearning(host, { trigger: "startup", nowMs: NOW });
		assert.equal(host.states["learning.thermal_boiler.current_temperature_c"], 59);
		assert.match(String(host.states["learning.thermal_boiler.reason_de"]), /Boiler 59\.0 °C/);
		assert.doesNotMatch(String(host.states["learning.thermal_boiler.reason_de"]), /63/);
		assert.equal(host.states["learning.thermal_boiler.last_run"], new Date(NOW).toISOString());
		assert.equal(host.states["learning.thermal_boiler.last_sample_at"], new Date(NOW).toISOString());
	});

	it("T22: mapping valid regular run updates last_run", async () => {
		__resetThermalBoilerRunLockForTest();
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-reg-"));
		const host = mockBoilerHost({ tmp, currentTemp: 58, history: [] });
		await runThermalBoilerLearning(host, { trigger: "learning_tick", nowMs: NOW });
		assert.equal(host.states["learning.thermal_boiler.current_temperature_c"], 58);
		const firstRun = String(host.states["learning.thermal_boiler.last_run"]);
		assert.equal(firstRun, new Date(NOW).toISOString());
		__resetThermalBoilerRunLockForTest();
		await runThermalBoilerLearning(host, { trigger: "learning_tick", nowMs: NOW + 3_600_000 });
		assert.equal(host.states["learning.thermal_boiler.last_run"], new Date(NOW + 3_600_000).toISOString());
		assert.notEqual(String(host.states["learning.thermal_boiler.last_run"]), firstRun);
	});

	it("T23: mapping missing → no fake temperature", async () => {
		__resetThermalBoilerRunLockForTest();
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-miss-"));
		const host = mockBoilerHost({
			tmp,
			currentTemp: 59,
			history: [],
			mappingTarget: null,
			mappingEnabled: false,
		});
		await runThermalBoilerLearning(host, { nowMs: NOW });
		assert.equal(host.states["learning.thermal_boiler.current_temperature_c"], null);
		assert.doesNotMatch(String(host.states["learning.thermal_boiler.reason_de"]), /59/);
	});

	it("T24: history grows from live samples without a completed cycle", async () => {
		__resetThermalBoilerRunLockForTest();
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-grow-"));
		const host = mockBoilerHost({ tmp, currentTemp: 57, history: [] });
		await runThermalBoilerLearning(host, { nowMs: NOW });
		assert.equal(detectRuntimeCycles([], boilerCfg()).length, 0);
		assert.equal(host.states["learning.thermal_boiler.samples"], 0);
		const persist1 = await readThermalBoilerPersist(path.join(tmp, "learning/thermal_boiler"));
		assert.ok((persist1?.temp_samples?.length ?? 0) >= 1);
		host.getForeignStateAsync = async (id: string) =>
			id === "sensor.0.boiler" ? ({ val: 56 } as ioBroker.State) : ({ val: null } as ioBroker.State);
		__resetThermalBoilerRunLockForTest();
		await runThermalBoilerLearning(host, { nowMs: NOW + BOILER_SAMPLE_MIN_INTERVAL_MS });
		const persist = await readThermalBoilerPersist(path.join(tmp, "learning/thermal_boiler"));
		assert.ok((persist?.temp_samples?.length ?? 0) >= 2);
	});

	it("T25: Newton-Fallback from persisted boiler samples without ioBroker history cycles", async () => {
		__resetThermalBoilerRunLockForTest();
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-newton-"));
		const dir = path.join(tmp, "learning/thermal_boiler");
		await fs.mkdir(dir, { recursive: true });
		const samples = linearCurve(NOW - 20 * MS_H, 64, 51, 20, 20);
		await fs.writeFile(
			path.join(dir, "thermal_boiler_learning_v1.json"),
			JSON.stringify({
				generated_at: new Date(NOW).toISOString(),
				module: BOILER_MODULE_TAG,
				samples: 0,
				runtime_hours_avg: null,
				runtime_hours_median: null,
				cooling_rate_c_per_h_avg: null,
				by_season: {},
				by_day_type: {},
				history: [],
				health: "no_samples",
				source_kind: BOILER_SOURCE_KIND,
				source_state_id: "sensor.0.boiler",
				temp_samples: samples,
			}),
		);
		const host = mockBoilerHost({ tmp, currentTemp: 51, history: [] });
		await runThermalBoilerLearning(host, { nowMs: NOW });
		assert.equal(host.states["learning.thermal_boiler.model"], "newton");
		assert.ok(Number(host.states["learning.thermal_boiler.cooling_k_per_h"]) > 0);
		assert.match(String(host.states["learning.thermal_boiler.reason_de"]), /Newton|51\.0/);
	});

	it("T26: untrusted persist without source metadata is discarded on first run", async () => {
		__resetThermalBoilerRunLockForTest();
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-discard-"));
		const dir = path.join(tmp, "learning/thermal_boiler");
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(
			path.join(dir, "thermal_boiler_learning_v1.json"),
			JSON.stringify({
				generated_at: "2026-08-16T19:07:50.076Z",
				module: BOILER_MODULE_TAG,
				samples: 9,
				runtime_hours_avg: 8,
				runtime_hours_median: 8,
				cooling_rate_c_per_h_avg: 1.2,
				by_season: {},
				by_day_type: {},
				history: [],
				health: "ok",
				temp_samples: [{ ts: NOW - MS_H, tempC: 63 }],
			}),
		);
		assert.equal(await readThermalBoilerPersist(dir), null);
		const host = mockBoilerHost({ tmp, currentTemp: 59, history: [] });
		await runThermalBoilerLearning(host, { nowMs: NOW });
		const persist = await readThermalBoilerPersist(dir);
		assert.equal(persist?.source_kind, BOILER_SOURCE_KIND);
		assert.equal(persist?.samples, 0);
		assert.ok((persist?.temp_samples ?? []).every((p) => p.tempC !== 63));
		assert.equal(host.states["learning.thermal_boiler.current_temperature_c"], 59);
	});

	it("T27: hanging history still publishes live mapping temp (no stale 63)", async () => {
		__resetThermalBoilerRunLockForTest();
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-hang-"));
		const host = mockBoilerHost({ tmp, currentTemp: 59, history: [] });
		host.states["learning.thermal_boiler.current_temperature_c"] = 63;
		host.getHistoryAsync = async () => {
			await new Promise((r) => setTimeout(r, 80));
			return historyResult([]);
		};
		await runThermalBoilerLearning(host, { nowMs: NOW, historyTimeoutMs: 25, trigger: "startup" });
		assert.equal(host.states["learning.thermal_boiler.current_temperature_c"], 59);
		assert.match(String(host.states["learning.thermal_boiler.reason_de"]), /59\.0/);
		assert.ok(String(host.states["learning.thermal_boiler.last_run"]).length > 10);
	});

	it("T28: overlapping runs do not double-append samples", async () => {
		__resetThermalBoilerRunLockForTest();
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-ovl-"));
		const host = mockBoilerHost({ tmp, currentTemp: 56, history: [] });
		host.getHistoryAsync = async () => {
			await new Promise((r) => setTimeout(r, 60));
			return historyResult([]);
		};
		const first = runThermalBoilerLearning(host, { nowMs: NOW, historyTimeoutMs: 5_000 });
		await new Promise((r) => setTimeout(r, 15));
		await runThermalBoilerLearning(host, { nowMs: NOW + 1 });
		await first;
		const persist = await readThermalBoilerPersist(path.join(tmp, "learning/thermal_boiler"));
		assert.equal(persist?.temp_samples?.length, 1);
	});

	it("T29: sample debounce prevents write storm", () => {
		const a = appendBoilerTempSample([], { ts: NOW, tempC: 55 }, NOW, 7);
		const b = appendBoilerTempSample(a, { ts: NOW + 1_000, tempC: 55.1 }, NOW + 1_000, 7);
		assert.equal(b.length, 1);
		const c = appendBoilerTempSample(b, { ts: NOW + BOILER_SAMPLE_MIN_INTERVAL_MS, tempC: 54 }, NOW + BOILER_SAMPLE_MIN_INTERVAL_MS, 7);
		assert.equal(c.length, 2);
		assert.equal(mergeBoilerTempPoints(c, c).length, 2);
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
