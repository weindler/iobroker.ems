/**
 * Boiler-Learning A — Newton/Cycles nur aus Boiler-Sensorhistorie.
 * Keine Puffer-Samples, keine Puffer-Konstanten, kein Fake-emptyAt.
 */

import { asNum, type StateHost } from "../../ems_light/state_util";
import { setStateIfChanged } from "../../policy/core/state_write";
import { resolveMappingTargetFromConfig } from "../../mapping_resolve";
import { fetchTemperatureHistory, isValidTempC } from "../thermal_runtime/history";
import {
	collectCoolingSegments,
	computeThermalRuntimeLearning,
	detectRuntimeCycles,
	estimateActiveCoolingRateCPerH,
	estimateCoolingModel,
	liveRemainingHoursFromEmptyAt,
	summarizeTempHistory,
} from "../thermal_runtime/math";
import type { ThermalRuntimeComputeResult } from "../thermal_runtime/types";
import { thermalBoilerConfigFromAdapter } from "./config";
import { ensureThermalBoilerLearningStates } from "./ensure_states";
import { readThermalBoilerPersist, writeThermalBoilerPersist } from "./persist";
import {
	appendBoilerTempSample,
	BOILER_HISTORY_FETCH_LOOKBACK_DAYS,
	BOILER_HISTORY_FETCH_TIMEOUT_MS,
	historyJsonFromBoilerPoints,
	mergeBoilerTempPoints,
	trimBoilerTempSamples,
	withTimeoutFallback,
} from "./samples";
import { pvBiasConfigFromAdapter } from "../pv_bias/config";
import type { TempPoint } from "../thermal_runtime/types";

export type ThermalBoilerRunHost = StateHost & {
	config?: unknown;
	getHistoryAsync?: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	getAbsolutePath?: (category?: string) => string;
	log?: { info?: (m: string) => void; warn?: (m: string) => void; debug?: (m: string) => void; error?: (m: string) => void };
};

const JSON_STATE_LIMIT = 10_000;

function truncateJson(obj: unknown): string {
	const raw = JSON.stringify(obj);
	if (raw.length <= JSON_STATE_LIMIT) return raw;
	return `${raw.slice(0, JSON_STATE_LIMIT - 20)}…truncated"}`;
}

/**
 * Native Mapping `ih_boiler_temp_c_*` — nicht Puffer, nicht planningMax, nicht Live-Cache.
 */
export async function resolveBoilerTempStateId(host: ThermalBoilerRunHost): Promise<string> {
	const mapped = resolveMappingTargetFromConfig(host.config, "immersion_heater", "boiler_temp_c");
	if (!mapped || !mapped.enabled) return "";
	return mapped.targetState;
}

/** Ist-Temperatur nur vom Mapping-Ziel — kein Live-Cache, kein Admin-Alias, kein planningMaxTempC. */
async function readCurrentTemp(host: ThermalBoilerRunHost, stateId: string): Promise<number | null> {
	if (!stateId) return null;
	try {
		const st = host.getForeignStateAsync
			? await host.getForeignStateAsync(stateId)
			: await host.getStateAsync(stateId);
		const n = asNum(st?.val);
		return isValidTempC(n) ? n : null;
	} catch {
		return null;
	}
}

function classifyModel(result: ThermalRuntimeComputeResult): "cycle" | "newton" | "none" {
	if ((result.samples ?? 0) > 0 && result.coolingRateCPerHAvg != null && result.coolingRateCPerHAvg > 0) {
		return "cycle";
	}
	if (result.coolingConstantPerH != null && result.coolingConstantPerH > 0) return "newton";
	return "none";
}

function qualityOf(
	model: "cycle" | "newton" | "none",
	samples: number,
	hasSource: boolean,
): string {
	if (!hasSource) return "no_source";
	if (model === "cycle" && samples >= 3) return "cycle";
	if (model === "newton" || model === "cycle") return "newton_fallback";
	return "insufficient_data";
}

function reasonDeOf(input: {
	temp: number | null;
	model: "cycle" | "newton" | "none";
	samples: number;
	segments: number;
	emptyAt: string | null;
	emptyThresholdC: number;
}): string {
	if (input.temp === null) {
		return "Boiler-Sensor fehlt — kein Fake-emptyAt; Hard nur bei verfügbarer Live-Temperatur.";
	}
	if (input.model === "cycle") {
		return `Boiler ${input.temp.toFixed(1)} °C — Cycle-Modell (${input.samples} Zyklen) bis Min ${input.emptyThresholdC} °C${input.emptyAt ? `, leer ~${input.emptyAt}` : ""}.`;
	}
	if (input.model === "newton") {
		return `Boiler ${input.temp.toFixed(1)} °C — Newton-Fallback aus Boiler-Verlauf (${input.segments} Segmente, ${input.samples} Zyklen), nicht Puffer.`;
	}
	return `Boiler ${input.temp.toFixed(1)} °C — noch kein belastbares Boiler-Kühlmodell; echte Samples werden gesammelt.`;
}

async function writeBoilerResult(
	host: ThermalBoilerRunHost,
	result: ThermalRuntimeComputeResult,
	meta: {
		lastRun: string;
		nextRun: string;
		segments: number;
		hasSource: boolean;
		emptyThresholdC: number;
		historyPoints: number;
		lastSampleAt: string;
		trigger: string;
		historyJsonOverride?: unknown;
	},
): Promise<void> {
	const model = classifyModel(result);
	const quality = qualityOf(model, result.samples, meta.hasSource);
	const reasonDe = reasonDeOf({
		temp: result.currentTemperatureC,
		model,
		samples: result.samples,
		segments: meta.segments,
		emptyAt: result.estimatedEmptyAt,
		emptyThresholdC: meta.emptyThresholdC,
	});
	await host.setStateAsync("learning.thermal_boiler.status", { val: result.status, ack: true });
	await host.setStateAsync("learning.thermal_boiler.health", { val: result.health, ack: true });
	await host.setStateAsync("learning.thermal_boiler.last_run", { val: meta.lastRun, ack: true });
	await host.setStateAsync("learning.thermal_boiler.last_sample_at", { val: meta.lastSampleAt, ack: true });
	await host.setStateAsync("learning.thermal_boiler.last_error", { val: result.lastError, ack: true });
	await host.setStateAsync("learning.thermal_boiler.samples", { val: result.samples, ack: true });
	await host.setStateAsync("learning.thermal_boiler.cooling_rate_c_per_h_avg", {
		val: result.coolingRateCPerHAvg,
		ack: true,
	});
	await host.setStateAsync("learning.thermal_boiler.cooling_k_per_h", {
		val: result.coolingConstantPerH,
		ack: true,
	});
	await host.setStateAsync("learning.thermal_boiler.cooling_asymptote_c", {
		val: result.coolingAsymptoteC,
		ack: true,
	});
	await host.setStateAsync("learning.thermal_boiler.current_temperature_c", {
		val: result.currentTemperatureC,
		ack: true,
	});
	await host.setStateAsync("learning.thermal_boiler.estimated_remaining_hours", {
		val: result.estimatedRemainingHours,
		ack: true,
	});
	await host.setStateAsync("learning.thermal_boiler.estimated_empty_at", {
		val: result.estimatedEmptyAt ?? "",
		ack: true,
	});
	await host.setStateAsync("learning.thermal_boiler.by_day_type_json", {
		val: truncateJson(result.byDayTypeJson),
		ack: true,
	});
	await host.setStateAsync("learning.thermal_boiler.model", { val: model, ack: true });
	await host.setStateAsync("learning.thermal_boiler.quality", { val: quality, ack: true });
	await setStateIfChanged(host, "learning.thermal_boiler.reason_de", reasonDe);
}

export async function refreshThermalBoilerRemainingCountdown(host: {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
}): Promise<void> {
	try {
		const st = await host.getStateAsync("learning.thermal_boiler.estimated_empty_at");
		const raw = typeof st?.val === "string" ? st.val.trim() : "";
		if (!raw) return;
		const live = liveRemainingHoursFromEmptyAt(raw, new Date());
		if (live === null) return;
		await host.setStateAsync("learning.thermal_boiler.estimated_remaining_hours", { val: live, ack: true });
	} catch {
		/* Diagnose */
	}
}

let boilerRunInFlight = false;

export type ThermalBoilerRunOptions = {
	trigger?: "startup" | "learning_tick" | "interval";
	historyTimeoutMs?: number;
	nowMs?: number;
};

function nextRunIso(now: Date, host: ThermalBoilerRunHost): string {
	const intervalSec = pvBiasConfigFromAdapter(host.config).intervalSec;
	return new Date(now.getTime() + intervalSec * 1000).toISOString();
}

function emptyBoilerCompute(input: {
	status: ThermalRuntimeComputeResult["status"];
	health: ThermalRuntimeComputeResult["health"];
	currentTemperatureC: number | null;
	sourceStateId: string;
	lastError: string;
}): ThermalRuntimeComputeResult {
	return {
		status: input.status,
		health: input.health,
		samples: 0,
		runtimeHoursAvg: null,
		runtimeHoursMedian: null,
		coolingRateCPerHAvg: null,
		coolingConstantPerH: null,
		coolingAsymptoteC: null,
		coolingAsymptoteSource: null,
		currentTemperatureC: input.currentTemperatureC,
		estimatedRemainingHours: null,
		estimatedEmptyAt: null,
		bySeasonJson: {},
		byDayTypeJson: {},
		historyJson: [],
		sourceStateId: input.sourceStateId,
		lastError: input.lastError,
	};
}

function resultMeta(
	host: ThermalBoilerRunHost,
	now: Date,
	over: {
		segments: number;
		hasSource: boolean;
		emptyThresholdC: number;
		historyPoints: number;
		lastSampleAt: string;
		trigger: string;
		historyJsonOverride?: unknown;
	},
) {
	return {
		lastRun: now.toISOString(),
		nextRun: nextRunIso(now, host),
		...over,
	};
}

/** Nur für Tests: Overlap-Lock zurücksetzen. */
export function __resetThermalBoilerRunLockForTest(): void {
	boilerRunInFlight = false;
}

export async function runThermalBoilerLearning(
	host: ThermalBoilerRunHost,
	opts: ThermalBoilerRunOptions = {},
): Promise<void> {
	if (boilerRunInFlight) return;
	boilerRunInFlight = true;
	try {
		await runThermalBoilerLearningInner(host, opts);
	} finally {
		boilerRunInFlight = false;
	}
}

async function runThermalBoilerLearningInner(
	host: ThermalBoilerRunHost,
	opts: ThermalBoilerRunOptions,
): Promise<void> {
	await ensureThermalBoilerLearningStates(host);
	const cfg = thermalBoilerConfigFromAdapter(host.config);
	const now = opts.nowMs != null ? new Date(opts.nowMs) : new Date();
	const trigger = opts.trigger ?? "learning_tick";
	const historyTimeoutMs = opts.historyTimeoutMs ?? BOILER_HISTORY_FETCH_TIMEOUT_MS;
	const stateId = await resolveBoilerTempStateId(host);
	const currentTempC = await readCurrentTemp(host, stateId);
	const metaBase = {
		emptyThresholdC: cfg.emptyThresholdC,
		trigger,
		lastSampleAt: currentTempC != null ? now.toISOString() : "",
		historyPoints: 0,
		segments: 0,
		hasSource: Boolean(stateId),
	};

	if (!cfg.enabled) {
		await writeBoilerResult(
			host,
			emptyBoilerCompute({
				status: "disabled",
				health: "no_source",
				currentTemperatureC: currentTempC,
				sourceStateId: stateId,
				lastError: "Thermal Learning in Admin deaktiviert.",
			}),
			resultMeta(host, now, { ...metaBase, hasSource: Boolean(stateId) }),
		);
		return;
	}

	if (!stateId) {
		await writeBoilerResult(
			host,
			emptyBoilerCompute({
				status: "no_source",
				health: "no_source",
				currentTemperatureC: null,
				sourceStateId: "",
				lastError: "Keine Boiler-Temperaturquelle — ih_boiler_temp_c_target.",
			}),
			resultMeta(host, now, { ...metaBase, hasSource: false, lastSampleAt: "" }),
		);
		return;
	}

	/*
	 * Sofort live schreiben — darf nicht hinter 90-Tage-History-Queue warten.
	 * Sonst bleibt ein Alt-Diagnosewert (z. B. 63 °C) nach Adapterstart stehen.
	 */
	await writeBoilerResult(
		host,
		emptyBoilerCompute({
			status: "insufficient_data",
			health: "no_samples",
			currentTemperatureC: currentTempC,
			sourceStateId: stateId,
			lastError: "",
		}),
		resultMeta(host, now, { ...metaBase, hasSource: true }),
	);

	let storedSamples: TempPoint[] = [];
	if (host.getAbsolutePath) {
		const persist = await readThermalBoilerPersist(host.getAbsolutePath("learning/thermal_boiler"));
		storedSamples = persist?.temp_samples ?? [];
	}
	if (currentTempC != null) {
		storedSamples = appendBoilerTempSample(
			storedSamples,
			{ ts: now.getTime(), tempC: currentTempC },
			now.getTime(),
			cfg.lookbackDays,
		);
	}

	let historyPoints: TempPoint[] = [];
	if (host.getHistoryAsync) {
		try {
			const historyLookbackDays = Math.min(cfg.lookbackDays, BOILER_HISTORY_FETCH_LOOKBACK_DAYS);
			const fetched = await withTimeoutFallback(
				fetchTemperatureHistory({ getHistoryAsync: host.getHistoryAsync }, stateId, historyLookbackDays),
				historyTimeoutMs,
				{ points: [] as TempPoint[], lastValidTs: null },
			);
			historyPoints = fetched.points;
		} catch (e) {
			host.log?.warn?.(`Boiler-Learning Historie: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	const points = trimBoilerTempSamples(
		mergeBoilerTempPoints(storedSamples, historyPoints),
		now.getTime(),
		cfg.lookbackDays,
	);
	const cycles = detectRuntimeCycles(points, cfg);
	const coolingSegments = collectCoolingSegments(points, cfg.minRuntimeHours);
	const activeCoolingRateCPerH = estimateActiveCoolingRateCPerH(points, cfg);
	const coolingModel = estimateCoolingModel(points, cfg);
	const hist = summarizeTempHistory(points, cfg.emptyThresholdC);
	const result = computeThermalRuntimeLearning({
		cycles,
		currentTempC,
		cfg: { ...cfg, temperatureStateId: stateId },
		sourceStateId: stateId,
		now,
		activeCoolingRateCPerH,
		coolingConstantPerH: coolingModel.coolingConstantPerH,
		asymptoteC: coolingModel.asymptoteC,
		asymptoteSource: coolingModel.asymptoteSource,
	});

	if (host.getAbsolutePath) {
		await writeThermalBoilerPersist(
			host.getAbsolutePath("learning/thermal_boiler"),
			result,
			now.toISOString(),
			stateId,
			points,
		);
	}

	const lastSample = points.length > 0 ? points[points.length - 1] : null;
	await writeBoilerResult(host, result, resultMeta(host, now, {
		segments: coolingSegments.length,
		hasSource: true,
		emptyThresholdC: cfg.emptyThresholdC,
		historyPoints: points.length,
		lastSampleAt: lastSample ? new Date(lastSample.ts).toISOString() : currentTempC != null ? now.toISOString() : "",
		trigger,
		historyJsonOverride: historyJsonFromBoilerPoints(points),
	}));

	host.log?.debug?.(
		`Boiler-Learning: status=${result.status} model=${classifyModel(result)} cycles=${result.samples} points=${points.length} segments=${coolingSegments.length} k=${coolingModel.coolingConstantPerH ?? "—"}/h remaining=${result.estimatedRemainingHours ?? "—"}h hist=${hist.minC ?? "—"}–${hist.maxC ?? "—"}°C floor=${cfg.emptyThresholdC}°C trigger=${trigger}`,
	);
}
