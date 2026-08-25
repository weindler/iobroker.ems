import {
	startAirConditioningModuleRuntime,
} from "../addons/air_conditioning";
import { startBatteryModuleRuntime } from "../addons/battery";
import { startImmersionHeaterModuleRuntime } from "../addons/immersion_heater";
import { startWallboxModuleRuntime } from "../addons/wallbox";
import { syncAddonGovernanceFromConfig } from "../addons/governance";
import { startEmsLightPhase1Runtime } from "../ems_light";
import { migrateAndSyncEconomicsFeedInFromConfig } from "../ems_light/economics_feed_in";
import { syncEconomicsTariffFeesFromConfig } from "../ems_light/economics_tariff_fees";
import { startFailsafeRunner } from "../failsafe_runner";
import {
	EXECUTION_MODE_ADDON_IDS,
	syncExecutionModesFromConfig,
	type ForceDryrunReason,
} from "../execution_mode";
import { getPendingForceDryrunReason } from "../restore/dryrun_context";
import { GLOBAL, addonMode } from "../tree_paths";
import { STATE } from "../states";
import { detectFullNamespaceColdStart } from "./cold_start";
import {
	bootstrapFailurePhase,
	isBootstrapComplete,
	markBootstrapComplete,
	markBootstrapFailed,
	resetBootstrapBarrierForTest,
} from "./barrier";
import { beginBootstrapRun, endBootstrapRun, getBootstrapRunContext } from "./context";
import {
	ensureDynamicVehicleProfiles,
	ensureStaticStateTree,
	cleanupDynamicPlaceholders,
	syncAllMappingsFromConfig,
	type StaticStateTreeHost,
} from "./ensure_static_tree";
import { hydratePersistedState } from "./persist_hydrate";
import { runPostBootstrapReconciliation } from "./reconcile";

export type StartupStepFn = (
	label: string,
	fn: () => Promise<unknown>,
	timeoutMs?: number,
) => Promise<void>;

export type BootstrapPhaseTraceFn = (phase: string, detail?: string) => void;

export interface AdapterBootstrapHost extends StaticStateTreeHost {
	subscribeStatesAsync: (pattern: string) => Promise<void>;
}

export interface BootstrapOptions {
	trace?: BootstrapPhaseTraceFn;
	strictBootstrap?: boolean;
}

async function runCriticalStep(
	step: StartupStepFn,
	label: string,
	fn: () => Promise<unknown>,
	strict: boolean,
): Promise<boolean> {
	try {
		await step(label, fn);
		return true;
	} catch (e) {
		markBootstrapFailed(label);
		if (strict) {
			throw e;
		}
		return false;
	}
}

/**
 * Verbindlicher Adapter-Startup A→F.
 * Phase A (Config) erfolgt vor dem Aufruf durch den Adapter.
 */
export async function runAdapterBootstrap(
	host: AdapterBootstrapHost,
	step: StartupStepFn,
	options: BootstrapOptions = {},
): Promise<void> {
	resetBootstrapBarrierForTest();
	endBootstrapRun();
	const trace = options.trace;
	const strict = options.strictBootstrap ?? false;
	const adapterConfig =
		host.config && typeof host.config === "object" ? (host.config as Record<string, unknown>) : {};

	trace?.("A", "config_ready");

	const coldStart = await detectFullNamespaceColdStart(host);
	const bootstrapCtx = beginBootstrapRun(coldStart);
	if (coldStart) {
		host.log.debug?.("Cold-Start-Recovery: leerer ems.0.*-Namespace erkannt");
	}

	trace?.("B", "static_state_tree");
	const staticOk = await runCriticalStep(
		step,
		"static state tree",
		() => ensureStaticStateTree(host),
		strict,
	);
	if (!staticOk) {
		host.log.error(`Bootstrap abgebrochen vor Runtime (Phase B fehlgeschlagen: ${bootstrapFailurePhase()})`);
		endBootstrapRun();
		return;
	}

	trace?.("C", "dynamic_vehicle_profiles_noop");
	await step("dynamic vehicle profiles (noop)", () => ensureDynamicVehicleProfiles(host));

	trace?.("C2", "dynamic_surface_cleanup");
	await step("dynamic surface cleanup", () => cleanupDynamicPlaceholders(host));

	trace?.("D", "persist_hydration");
	await step("persist hydration", () => hydratePersistedState(host));

	trace?.("sync", "governance_and_mappings");
	await step("sync governance", () => syncAddonGovernanceFromConfig(host, adapterConfig));
	await step("sync execution modes", () => {
		const restoreReason = getPendingForceDryrunReason();
		const forceDryrunReason: ForceDryrunReason | null =
			restoreReason ?? (bootstrapCtx.coldStartRecovery ? "namespace_cold_start" : null);
		return syncExecutionModesFromConfig(host, adapterConfig, { forceDryrunReason });
	});
	await step("sync mappings", () => syncAllMappingsFromConfig(host));
	await step("sync economics feed-in", () => {
		const h = host as AdapterBootstrapHost & {
			updateConfig?: (c: Record<string, unknown>) => Promise<unknown>;
		};
		return migrateAndSyncEconomicsFeedInFromConfig({
			setObjectNotExistsAsync: host.setObjectNotExistsAsync.bind(host),
			getStateAsync: host.getStateAsync.bind(host),
			setStateAsync: host.setStateAsync.bind(host),
			extendObjectAsync: host.extendObjectAsync?.bind(host),
			config: adapterConfig,
			updateConfig:
				typeof h.updateConfig === "function" ? h.updateConfig.bind(host) : undefined,
			log: host.log,
		});
	});
	await step("sync economics tariff fees", () =>
		syncEconomicsTariffFeesFromConfig({
			setObjectNotExistsAsync: host.setObjectNotExistsAsync.bind(host),
			getStateAsync: host.getStateAsync.bind(host),
			setStateAsync: host.setStateAsync.bind(host),
			extendObjectAsync: host.extendObjectAsync?.bind(host),
			config: adapterConfig,
			log: host.log,
		}),
	);

	if (bootstrapFailurePhase()) {
		host.log.error(`Bootstrap abgebrochen vor Runtime (${bootstrapFailurePhase()})`);
		endBootstrapRun();
		return;
	}

	trace?.("E", "subscriptions");
	await step("wallbox runtime", () => startWallboxModuleRuntime(host));
	await step("battery runtime", () => startBatteryModuleRuntime(host));
	await step("immersion runtime", () => startImmersionHeaterModuleRuntime(host));
	await step("air conditioning runtime", () => startAirConditioningModuleRuntime(host));

	trace?.("F", "runtime");
	await step("failsafe runner", async () => startFailsafeRunner(host));
	await step("ems-light runtime", () => startEmsLightPhase1Runtime(host), 45_000);

	await step("subscribe command inbox", () => host.subscribeStatesAsync(STATE.command.inbox));
	await step("subscribe execution modes", async () => {
		await host.subscribeStatesAsync(GLOBAL.executionMode);
		for (const addonId of EXECUTION_MODE_ADDON_IDS) {
			await host.subscribeStatesAsync(addonMode(addonId));
		}
	});

	markBootstrapComplete();
	trace?.("complete", "bootstrap_barrier_open");

	await step("post-bootstrap reconciliation", () => runPostBootstrapReconciliation(host));
	endBootstrapRun();
}

export {
	isBootstrapComplete,
	bootstrapFailurePhase,
	resetBootstrapBarrierForTest,
	getBootstrapRunContext,
};
