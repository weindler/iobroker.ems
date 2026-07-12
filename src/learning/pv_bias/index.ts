import { ensurePvBiasStates } from "./ensure_states";
import { runPvBiasLearning, type PvBiasRunHost } from "./run";
import { pvBiasConfigFromAdapter } from "./config";
import { ensurePriceLearningStates, runPriceLearning } from "../price_learning";
import { ensurePriceForecastLearningStates, runPriceForecastLearning } from "../price_forecast";
import { ensureHouseLoadLearningStates, runHouseLoadLearning } from "../house_load";
import { ensureThermalRuntimeLearningStates, runThermalRuntimeLearning } from "../thermal_runtime";
import { ensureBatteryRuntimeLearningStates, runBatteryRuntimeLearning } from "../battery_runtime";
import { ensureEnergyDailyRollupForLearning } from "../energy_daily_rollup";
import { ensurePowerRollupForLearning } from "../power_rollup";
import { ensurePvHorizonLearningStates, runPvHorizon } from "../pv_horizon";
import { withLearningDataPath } from "../data_dir";
import { withHistoryBridge } from "../history_bridge";
import {
	ensureLearningPersistenceStates,
	mirrorLearningPersistenceToStates,
	restoreLearningPersistenceFromStates,
	type PersistenceMirrorHost,
} from "../persistence_mirror";
import type { StateHost } from "../../ems_light/state_util";
import { setMemoryInventoryContext, logMemoryInventory } from "../../diagnostics/memory_inventory";
import { probeStartupMemory } from "../../diagnostics/startup_memory";

let pvBiasTimer: NodeJS.Timeout | null = null;

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
	await ensureBatteryRuntimeLearningStates(host);
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

	void runLearningTick(host).catch((e) => {
		adapter.log.error(`PV-Bias/Horizon initial run: ${e}`);
	});

	pvBiasTimer = setInterval(() => {
		void runLearningTick(host).catch((e) => {
			adapter.log.error(`PV-Bias/Horizon tick: ${e}`);
		});
	}, cfg.intervalSec * 1000);

	adapter.log.debug?.(
		`EMS-Light PV-Bias + PV-Horizon + Price + House-Load + Thermal + Battery-Runtime ready (read-only, interval ${cfg.intervalSec}s)`,
	);
}

async function runLearningModule(
	host: PvBiasRunHost & StateHost,
	module: string,
	run: () => Promise<void>,
): Promise<void> {
	setMemoryInventoryContext(module);
	probeStartupMemory(host.log, `before_learning_${module}`);
	await run();
	logMemoryInventory(host.log, module, `after_${module}`);
	probeStartupMemory(host.log, `after_learning_${module}`);
}

async function runLearningTick(host: PvBiasRunHost & StateHost): Promise<void> {
	await runLearningModule(host, "energy_daily_rollup", () => ensureEnergyDailyRollupForLearning(host));
	await runLearningModule(host, "pv_bias", () => runPvBiasLearning(host));
	await runLearningModule(host, "pv_horizon", () => runPvHorizon(host));
	await runLearningModule(host, "price_learning", () => runPriceLearning(host));
	await runLearningModule(host, "power_rollup", () => ensurePowerRollupForLearning(host));
	await runLearningModule(host, "house_load", () => runHouseLoadLearning(host));
	await runLearningModule(host, "thermal_runtime", () => runThermalRuntimeLearning(host));
	await runLearningModule(host, "battery_runtime", () => runBatteryRuntimeLearning(host));
	await runLearningModule(host, "price_forecast", () => runPriceForecastLearning(host));
	await runLearningModule(host, "persistence_mirror", () =>
		mirrorLearningPersistenceToStates(host as unknown as PersistenceMirrorHost),
	);
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
