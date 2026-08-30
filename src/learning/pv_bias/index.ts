import { ensurePvBiasStates } from "./ensure_states";
import { runPvBiasLearning, type PvBiasRunHost } from "./run";
import { pvBiasConfigFromAdapter } from "./config";
import { ensurePriceLearningStates, runPriceLearning } from "../price_learning";
import { ensurePriceForecastLearningStates, runPriceForecastLearning } from "../price_forecast";
import { ensureHouseLoadLearningStates, runHouseLoadLearning } from "../house_load";
import { ensureThermalRuntimeLearningStates, runThermalRuntimeLearning } from "../thermal_runtime";
import { ensureThermalBoilerLearningStates, runThermalBoilerLearning } from "../thermal_boiler";
import { ensureBatteryRuntimeLearningStates, runBatteryRuntimeLearning } from "../battery_runtime";
import { ensureEnergyDailyRollupForLearning } from "../energy_daily_rollup";
import { ensurePowerRollupForLearning } from "../power_rollup";
import { ensurePvHorizonLearningStates, runPvHorizon } from "../pv_horizon";
import { ensureDayTelemetryStates } from "../day_telemetry";
import { ensureDailyEvaluatorStates, runDailyEvaluatorBatch, type DailyEvaluatorHost } from "../daily_evaluator";
import { intentAdminConfigFromAdapter } from "../../intent/config";
import { withLearningDataPath } from "../data_dir";
import { withHistoryBridge } from "../history_bridge";
import {
	ensureLearningPersistenceStates,
	mirrorLearningPersistenceToStates,
	restoreLearningPersistenceFromStates,
	type PersistenceMirrorHost,
} from "../persistence_mirror";
import type { StateHost } from "../../ems_light/state_util";

let pvBiasTimer: NodeJS.Timeout | null = null;
let learningTickInFlight = false;

export type LearningStateTreeHost = PvBiasRunHost & StateHost & PersistenceMirrorHost;

/** Phase B — Learning-States ohne Timer oder Persist-Restore. */
export async function ensureLearningStateTree(adapter: ioBroker.Adapter): Promise<LearningStateTreeHost> {
	const host = withHistoryBridge(
		adapter,
		withLearningDataPath(adapter, adapter as unknown as PvBiasRunHost & StateHost),
	) as LearningStateTreeHost;
	await ensurePvBiasStates(host);
	await ensurePvHorizonLearningStates(host);
	await ensurePriceLearningStates(host);
	await ensurePriceForecastLearningStates(host);
	await ensureHouseLoadLearningStates(host);
	await ensureThermalRuntimeLearningStates(host);
	await ensureThermalBoilerLearningStates(host);
	await ensureBatteryRuntimeLearningStates(host);
	await ensureDayTelemetryStates(host);
	await ensureDailyEvaluatorStates(host);
	await ensureLearningPersistenceStates(host);
	return host;
}

/** Phase D/F — Learning-Timer (Persist-Restore erfolgt in Phase D). */
export async function startPvBiasLearningRuntime(
	adapter: ioBroker.Adapter,
	host: LearningStateTreeHost,
): Promise<void> {
	const cfg = pvBiasConfigFromAdapter(adapter.config);
	stopPvBiasLearning();

	void runLearningTick(host, "startup").catch((e) => {
		adapter.log.error(`PV-Bias/Horizon initial run: ${e}`);
	});

	pvBiasTimer = setInterval(() => {
		void runLearningTick(host, "interval").catch((e) => {
			adapter.log.error(`PV-Bias/Horizon tick: ${e}`);
		});
	}, cfg.intervalSec * 1000);

	adapter.log.debug?.(
		`EMS-Light PV-Bias + PV-Horizon + Price + House-Load + Thermal + Battery-Runtime ready (read-only, interval ${cfg.intervalSec}s)`,
	);
}

async function runLearningTick(
	host: PvBiasRunHost & StateHost,
	trigger: "startup" | "interval" = "interval",
): Promise<void> {
	if (learningTickInFlight) return;
	learningTickInFlight = true;
	try {
		/*
		 * Boiler zuerst: Live-Diagnose darf nicht hinter PV-Bias/House-Load/90-Tage-Puffer-History
		 * in der gemeinsamen History-Queue stecken bleiben.
		 */
		try {
			await runThermalBoilerLearning(host, { trigger: trigger === "startup" ? "startup" : "learning_tick" });
		} catch (e) {
			host.log.error(`Boiler-Learning tick: ${e instanceof Error ? e.message : String(e)}`);
		}
		await ensureEnergyDailyRollupForLearning(host);
		await runPvBiasLearning(host);
		await runPvHorizon(host);
		await runPriceLearning(host);
		// Rollup-Backfill vor House-Load/Battery — sonst fällt der erste Lauf auf history.0 zurück.
		await ensurePowerRollupForLearning(host);
		// House/Thermal/Battery vor Price Forecast — Forecast-Matching lädt viele History-Tage.
		await runHouseLoadLearning(host);
		await runThermalRuntimeLearning(host);
		await runBatteryRuntimeLearning(host);
		await runPriceForecastLearning(host);
		await mirrorLearningPersistenceToStates(host as unknown as PersistenceMirrorHost);
		/*
		 * BLOCK A — Daily Evaluator (rein additiv/diagnostisch). Liest nur day_telemetry,
		 * schreibt ausschließlich in sein eigenes findings/scores/learning_state_v1 —
		 * nie in die aktiven Learning-Module oberhalb und nie ins reale Planner-/
		 * Control-Verhalten. Läuft bewusst im selben (langsamen) Lern-Intervall statt
		 * im schnellen EMS-Tick, da day_telemetry-Tage ohnehin nur einmal täglich
		 * abschließen.
		 */
		try {
			const timezone = intentAdminConfigFromAdapter(host.config).timezone || "Europe/Berlin";
			await runDailyEvaluatorBatch(host as unknown as DailyEvaluatorHost, { timezone });
		} catch (e) {
			host.log.error(`daily_evaluator batch: ${e instanceof Error ? e.message : String(e)}`);
		}
	} finally {
		learningTickInFlight = false;
	}
}

export async function initPvBiasLearning(adapter: ioBroker.Adapter): Promise<void> {
	const host = await ensureLearningStateTree(adapter);
	await startPvBiasLearningRuntime(adapter, host);
}

export function stopPvBiasLearning(): void {
	if (pvBiasTimer) {
		clearInterval(pvBiasTimer);
		pvBiasTimer = null;
	}
}

/** Nur für Tests. */
export function __resetLearningRuntimeForTest(): void {
	stopPvBiasLearning();
	learningTickInFlight = false;
}

export function __hasPvBiasLearningTimerForTest(): boolean {
	return pvBiasTimer != null;
}

export function __isLearningTickInFlightForTest(): boolean {
	return learningTickInFlight;
}
