import { asNum } from "../../ems_light/state_util";
import {
	configIsValid,
	sourceLabelFromStateId,
	thermalRuntimeConfigFromAdapter,
} from "./config";
import { fetchTemperatureHistory, isValidTempC } from "./history";
import { resolveThermalTemperatureStateId } from "./mapping";
import {
	collectCoolingSegments,
	computeThermalRuntimeLearning,
	detectRuntimeCycles,
	disabledResult,
	errorResult,
	estimateActiveCoolingRateCPerH,
	estimateCoolingModel,
	invalidConfigResult,
	liveRemainingHoursFromEmptyAt,
	noSourceResult,
	summarizeTempHistory,
} from "./math";
import { writeThermalRuntimePersist } from "./persist";
import type { ThermalRuntimeComputeResult } from "./types";

export type ThermalRuntimeRunHost = {
	config: unknown;
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	getAbsolutePath?: (category?: string) => string;
	log: { info: (msg: string) => void;
		debug?: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
};

const JSON_STATE_LIMIT = 10_000;

function truncateJson(obj: unknown): string {
	const raw = JSON.stringify(obj);
	if (raw.length <= JSON_STATE_LIMIT) {
		return raw;
	}
	return `${raw.slice(0, JSON_STATE_LIMIT - 20)}…truncated"}`;
}

async function setNumIfValid(
	host: ThermalRuntimeRunHost,
	id: string,
	value: number | null,
): Promise<void> {
	if (value !== null && Number.isFinite(value)) {
		await host.setStateAsync(id, { val: value, ack: true });
	}
}

async function setNumOrClear(
	host: ThermalRuntimeRunHost,
	id: string,
	value: number | null,
): Promise<void> {
	if (value !== null && Number.isFinite(value)) {
		await host.setStateAsync(id, { val: value, ack: true });
	} else {
		await host.setStateAsync(id, { val: null, ack: true });
	}
}

/** Minimaler Host für den Live-Countdown (EMS-Tick, kein History nötig). */
export type ThermalCountdownHost = {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
};

/**
 * Hält `estimated_remaining_hours` als Live-Countdown zu `estimated_empty_at` aktuell
 * (zwischen den stündlichen Learning-Läufen). Kein neues Modell — nur Wanduhr.
 */
export async function refreshThermalRemainingCountdown(host: ThermalCountdownHost): Promise<void> {
	try {
		const st = await host.getStateAsync("learning.thermal_runtime.estimated_empty_at");
		const raw = typeof st?.val === "string" ? st.val.trim() : "";
		if (!raw) return;
		const live = liveRemainingHoursFromEmptyAt(raw, new Date());
		if (live === null) return;
		await host.setStateAsync("learning.thermal_runtime.estimated_remaining_hours", {
			val: live,
			ack: true,
		});
	} catch {
		// fail-soft — Countdown ist Diagnose, kein Steuerpfad
	}
}

async function readCurrentTemp(
	host: ThermalRuntimeRunHost,
	stateId: string,
): Promise<number | null> {
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

async function writeResult(
	host: ThermalRuntimeRunHost,
	result: ThermalRuntimeComputeResult,
	lastRun: string,
): Promise<void> {
	await host.setStateAsync("learning.thermal_runtime.status", { val: result.status, ack: true });
	await host.setStateAsync("learning.thermal_runtime.health", { val: result.health, ack: true });
	await host.setStateAsync("learning.thermal_runtime.last_run", { val: lastRun, ack: true });
	await host.setStateAsync("learning.thermal_runtime.last_error", { val: result.lastError, ack: true });
	await setNumIfValid(host, "learning.thermal_runtime.samples", result.samples);
	await setNumIfValid(host, "learning.thermal_runtime.runtime_hours_avg", result.runtimeHoursAvg);
	await setNumIfValid(
		host,
		"learning.thermal_runtime.cooling_rate_c_per_h_avg",
		result.coolingRateCPerHAvg,
	);
	await setNumIfValid(host, "learning.thermal_runtime.cooling_k_per_h", result.coolingConstantPerH);
	await setNumIfValid(host, "learning.thermal_runtime.cooling_asymptote_c", result.coolingAsymptoteC);
	await setNumIfValid(
		host,
		"learning.thermal_runtime.current_temperature_c",
		result.currentTemperatureC,
	);
	await setNumOrClear(
		host,
		"learning.thermal_runtime.estimated_remaining_hours",
		result.estimatedRemainingHours,
	);
	await host.setStateAsync("learning.thermal_runtime.estimated_empty_at", {
		val: result.estimatedEmptyAt ?? "",
		ack: true,
	});
	await host.setStateAsync("learning.thermal_runtime.by_day_type_json", {
		val: truncateJson(result.byDayTypeJson),
		ack: true,
	});
	const model =
		(result.samples ?? 0) > 0 && result.coolingRateCPerHAvg != null && result.coolingRateCPerHAvg > 0
			? "cycle"
			: result.coolingConstantPerH != null && result.coolingConstantPerH > 0
				? "newton"
				: "none";
	await host.setStateAsync("learning.thermal_runtime.model", { val: model, ack: true });
	await host.setStateAsync("learning.thermal_runtime.quality", {
		val: model === "cycle" ? "cycle" : model === "newton" ? "newton_fallback" : result.status,
		ack: true,
	});
}

export async function runThermalRuntimeLearning(host: ThermalRuntimeRunHost): Promise<void> {
	const cfg = thermalRuntimeConfigFromAdapter(host.config);
	const now = new Date();
	const lastRun = now.toISOString();

	if (!cfg.enabled) {
		await writeResult(host, disabledResult(), lastRun);
		return;
	}

	if (!configIsValid(cfg)) {
		await writeResult(host, invalidConfigResult(""), lastRun);
		return;
	}

	const resolved = await resolveThermalTemperatureStateId(host, cfg.temperatureStateId);
	if (!resolved.stateId) {
		await writeResult(host, noSourceResult(), lastRun);
		return;
	}

	try {
		const currentTempC = await readCurrentTemp(host, resolved.stateId);
		const { points } = await fetchTemperatureHistory(host, resolved.stateId, cfg.lookbackDays);
		const histSummary = summarizeTempHistory(points, cfg.emptyThresholdC);
		const cycles = detectRuntimeCycles(points, cfg);
		const coolingSegments = collectCoolingSegments(points, cfg.minRuntimeHours);
		const activeCoolingRateCPerH = estimateActiveCoolingRateCPerH(points, cfg);
		const coolingModel = estimateCoolingModel(points, cfg);
		const result = computeThermalRuntimeLearning({
			cycles,
			currentTempC,
			cfg,
			sourceStateId: resolved.stateId,
			now,
			activeCoolingRateCPerH,
			coolingConstantPerH: coolingModel.coolingConstantPerH,
			asymptoteC: coolingModel.asymptoteC,
			asymptoteSource: coolingModel.asymptoteSource,
		});

		if (host.getAbsolutePath) {
			await writeThermalRuntimePersist(
				host.getAbsolutePath("learning/thermal_runtime"),
				result,
				lastRun,
			);
		}

		await writeResult(host, result, lastRun);

		host.log.debug?.(
			`Thermal-Runtime-Learning: status=${result.status} health=${result.health} cycles=${result.samples} source=${sourceLabelFromStateId(resolved.stateId)} k=${coolingModel.coolingConstantPerH ?? "—"}/h asym=${coolingModel.asymptoteC}°C(${coolingModel.asymptoteSource}) active_rate=${activeCoolingRateCPerH ?? "—"}°C/h (cooling_segments=${coolingSegments.length}) remaining=${result.estimatedRemainingHours ?? "—"}h`,
		);

		if (result.status === "insufficient_data") {
			host.log.warn(
				`Thermal Runtime Learning: ungenügende Zyklen (samples=${result.samples}, history_points=${points.length}, temp=${histSummary.minC ?? "—"}–${histSummary.maxC ?? "—"}°C, floor=${cfg.emptyThresholdC}°C, above_floor=${histSummary.pointsAboveFloor})`,
			);
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		host.log.error(`Thermal Runtime Learning: ${msg}`);
		await writeResult(host, errorResult(msg, resolved.stateId), lastRun);
	}
}
