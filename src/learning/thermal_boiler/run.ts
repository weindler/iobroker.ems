/**
 * Boiler-Learning A — Newton/Cycles nur aus Boiler-Sensorhistorie.
 * Keine Puffer-Samples, keine Puffer-Konstanten, kein Fake-emptyAt.
 */

import { asNum, type StateHost } from "../../ems_light/state_util";
import { setStateIfChanged } from "../../policy/core/state_write";
import { mappingBase } from "../../tree_paths";
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
import { writeThermalBoilerPersist } from "./persist";

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

export async function resolveBoilerTempStateId(host: ThermalBoilerRunHost): Promise<string> {
	const c = host.config && typeof host.config === "object" ? (host.config as Record<string, unknown>) : {};
	const admin = typeof c.ih_boiler_temp_c_target === "string" ? c.ih_boiler_temp_c_target.trim() : "";
	if (admin) return admin;
	const base = mappingBase("immersion_heater", "boiler_temp_c");
	const en = await host.getStateAsync(`${base}.enabled`);
	if (en?.val === false) return "";
	const t = await host.getStateAsync(`${base}.target_state`);
	return typeof t?.val === "string" ? t.val.trim() : "";
}

async function readCurrentTemp(host: ThermalBoilerRunHost, stateId: string): Promise<number | null> {
	if (stateId) {
		try {
			const st = host.getForeignStateAsync
				? await host.getForeignStateAsync(stateId)
				: await host.getStateAsync(stateId);
			const n = asNum(st?.val);
			if (isValidTempC(n)) return n;
		} catch {
			/* live fallback */
		}
	}
	const live = asNum((await host.getStateAsync("live.thermal.boiler_temp_c"))?.val);
	return isValidTempC(live) ? live : null;
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
	meta: { lastRun: string; segments: number; hasSource: boolean; emptyThresholdC: number },
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
	await host.setStateAsync("learning.thermal_boiler.cooling_asymptote_source", {
		val: result.coolingAsymptoteSource ?? "",
		ack: true,
	});
	await host.setStateAsync("learning.thermal_boiler.cooling_segments", { val: meta.segments, ack: true });
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
	await host.setStateAsync("learning.thermal_boiler.history_json", {
		val: truncateJson(result.historyJson),
		ack: true,
	});
	await host.setStateAsync("learning.thermal_boiler.model", { val: model, ack: true });
	await host.setStateAsync("learning.thermal_boiler.quality", { val: quality, ack: true });
	await host.setStateAsync("learning.thermal_boiler.vessel", { val: "boiler", ack: true });
	await host.setStateAsync("learning.thermal_boiler.hard_relevance", { val: model !== "none", ack: true });
	await host.setStateAsync("learning.thermal_boiler.soft_relevance", { val: false, ack: true });
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

export async function runThermalBoilerLearning(host: ThermalBoilerRunHost): Promise<void> {
	await ensureThermalBoilerLearningStates(host);
	const cfg = thermalBoilerConfigFromAdapter(host.config);
	const now = new Date();
	const lastRun = now.toISOString();
	const stateId = await resolveBoilerTempStateId(host);
	const currentTempC = await readCurrentTemp(host, stateId);

	if (!cfg.enabled) {
		await writeBoilerResult(
			host,
			{
				status: "disabled",
				health: "no_source",
				samples: 0,
				runtimeHoursAvg: null,
				runtimeHoursMedian: null,
				coolingRateCPerHAvg: null,
				coolingConstantPerH: null,
				coolingAsymptoteC: null,
				coolingAsymptoteSource: null,
				currentTemperatureC: currentTempC,
				estimatedRemainingHours: null,
				estimatedEmptyAt: null,
				bySeasonJson: {},
				byDayTypeJson: {},
				historyJson: [],
				sourceStateId: stateId,
				lastError: "Thermal Learning in Admin deaktiviert.",
			},
			{ lastRun, segments: 0, hasSource: Boolean(stateId), emptyThresholdC: cfg.emptyThresholdC },
		);
		return;
	}

	if (!stateId && currentTempC === null) {
		await writeBoilerResult(
			host,
			{
				status: "no_source",
				health: "no_source",
				samples: 0,
				runtimeHoursAvg: null,
				runtimeHoursMedian: null,
				coolingRateCPerHAvg: null,
				coolingConstantPerH: null,
				coolingAsymptoteC: null,
				coolingAsymptoteSource: null,
				currentTemperatureC: null,
				estimatedRemainingHours: null,
				estimatedEmptyAt: null,
				bySeasonJson: {},
				byDayTypeJson: {},
				historyJson: [],
				sourceStateId: "",
				lastError: "Keine Boiler-Temperaturquelle — mapping.boiler_temp_c oder ih_boiler_temp_c_target.",
			},
			{ lastRun, segments: 0, hasSource: false, emptyThresholdC: cfg.emptyThresholdC },
		);
		return;
	}

	let points: { ts: number; tempC: number }[] = [];
	if (stateId && host.getHistoryAsync) {
		try {
			const fetched = await fetchTemperatureHistory(
				{ getHistoryAsync: host.getHistoryAsync },
				stateId,
				cfg.lookbackDays,
			);
			points = fetched.points;
		} catch (e) {
			host.log?.warn?.(`Boiler-Learning Historie: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

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
		await writeThermalBoilerPersist(host.getAbsolutePath("learning/thermal_boiler"), result, lastRun);
	}

	await writeBoilerResult(host, result, {
		lastRun,
		segments: coolingSegments.length,
		hasSource: Boolean(stateId) || currentTempC !== null,
		emptyThresholdC: cfg.emptyThresholdC,
	});

	host.log?.debug?.(
		`Boiler-Learning: status=${result.status} model=${classifyModel(result)} cycles=${result.samples} segments=${coolingSegments.length} k=${coolingModel.coolingConstantPerH ?? "—"}/h remaining=${result.estimatedRemainingHours ?? "—"}h hist=${hist.minC ?? "—"}–${hist.maxC ?? "—"}°C floor=${cfg.emptyThresholdC}°C`,
	);
}
