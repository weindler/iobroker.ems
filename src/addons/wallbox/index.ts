import {
	configuredEvccTelemetryStateIds,
	wallboxEvccTelemetryConfigFromAdapter,
} from "./evcc_config";
import { ensureWallboxEvccStates, WALLBOX_EVCC_STATES } from "./ensure_evcc_states";
import { readEvccTelemetrySnapshot, type EvccTelemetryReadHost } from "./evcc_telemetry";
import type { TelemetryField } from "./normalize";
import { isAddonGovernanceEnabledFromState, addonGovernanceEnabledState } from "../governance";
import { isLiveWriteAllowed } from "../../execution_mode";
import { addonEnabled, GLOBAL, addonMode } from "../../tree_paths";
import {
	ALLOCATION_ADDON_STATE_IDS,
	DAILY_PLAN_STATE_IDS,
} from "../../operator/daily_plan/states";
import {
	buildWallboxDispatchIntent,
	ensureWallboxRuntimeStates,
	publishWallboxDispatchStates,
	publishWallboxLiveFoundationStates,
	publishWallboxRuntimeStates,
	resetWallboxDailyPlanCache,
	resetWallboxDispatchCache,
	resolveWallboxDailyPlanDecision,
	runWallboxDryrunDispatch,
	runWallboxLiveFoundation,
	telemetryInputFromSnapshot,
} from "./runtime";

type WallboxHost = EvccTelemetryReadHost &
	ioBroker.Adapter & {
		subscribeForeignStatesAsync?: (id: string) => Promise<void>;
		unsubscribeForeignStatesAsync?: (id: string) => Promise<void>;
	};

let activeHost: WallboxHost | null = null;
const subscribedIds: string[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const DEBOUNCE_MS = 300;

async function writeField(
	host: WallboxHost,
	stateId: string,
	field: TelemetryField<boolean | number | string>,
): Promise<void> {
	if (field.status === "missing" || field.value === null) {
		return;
	}
	const val = field.value;
	await host.setStateAsync(stateId, { val, ack: true });
}

/**
 * Spiegelt einen Planzeit-Feld in einen String-State (role: date).
 * Anders als writeField wird der State bei null/ungültig ausdrücklich auf ""
 * gesetzt, damit kein alter EVCC-Deadline-Zeitstempel stale stehen bleibt.
 */
async function writeTimeField(
	host: WallboxHost,
	stateId: string,
	field: TelemetryField<string>,
): Promise<void> {
	const val = field.status === "valid" && typeof field.value === "string" ? field.value : "";
	await host.setStateAsync(stateId, { val, ack: true });
}

const WALLBOX_ADDON_ID = "wallbox";

async function refreshWallboxDailyPlanRuntime(host: WallboxHost, snap: Awaited<ReturnType<typeof readEvccTelemetrySnapshot>>): Promise<void> {
	const cfg = wallboxEvccTelemetryConfigFromAdapter(host.config);
	const addonOn = await host.getStateAsync(addonEnabled(WALLBOX_ADDON_ID));
	const addonEnabledVal = addonOn?.val !== false;
	const governanceEnabled = await isAddonGovernanceEnabledFromState(
		(id) => host.getStateAsync(id),
		WALLBOX_ADDON_ID,
	);
	const now = new Date();
	const decision = await resolveWallboxDailyPlanDecision(host, snap, cfg, now, {
		governanceEnabled,
		addonEnabled: addonEnabledVal,
	});
	await publishWallboxRuntimeStates(host, decision, governanceEnabled);

	const telemetry = telemetryInputFromSnapshot(snap, cfg);
	const phases = telemetry.activePhases ?? telemetry.configuredPhases;
	const intent = buildWallboxDispatchIntent({
		decision,
		governanceEnabled,
		addonEnabled: addonEnabledVal,
		phases,
		now,
	});
	const chargingEnabled =
		snap.enabled.status === "valid" && typeof snap.enabled.value === "boolean" ? snap.enabled.value : null;
	const dispatch = runWallboxDryrunDispatch({
		intent,
		decision,
		telemetry,
		config: host.config,
		chargingEnabled,
		governanceEnabled,
	});
	await publishWallboxDispatchStates(host, decision, dispatch);

	const liveRequested = await isLiveWriteAllowed((id) => host.getStateAsync(id), WALLBOX_ADDON_ID);
	const foundation = await runWallboxLiveFoundation({
		dispatch,
		decision,
		addonEnabled: addonEnabledVal,
		governanceEnabled,
		liveRequested,
		now,
	});
	await publishWallboxLiveFoundationStates(host, foundation);
}

export async function refreshWallboxEvccTelemetry(host: WallboxHost): Promise<void> {
	const cfg = wallboxEvccTelemetryConfigFromAdapter(host.config);
	const snap = await readEvccTelemetrySnapshot(host, cfg, new Date());

	await host.setStateAsync(WALLBOX_EVCC_STATES.snapshotJson, {
		val: JSON.stringify(snap),
		ack: true,
	});
	await host.setStateAsync(WALLBOX_EVCC_STATES.updatedAt, { val: snap.observed_at, ack: true });

	await writeField(host, WALLBOX_EVCC_STATES.enabled, snap.enabled);
	await writeField(host, WALLBOX_EVCC_STATES.connected, snap.connected);
	await writeField(host, WALLBOX_EVCC_STATES.charging, snap.charging);
	await writeField(host, WALLBOX_EVCC_STATES.chargePowerW, snap.charge_power_w);
	await writeField(host, WALLBOX_EVCC_STATES.sessionEnergyKwh, snap.session_energy_kwh);
	await writeField(host, WALLBOX_EVCC_STATES.vehicleSocPct, snap.vehicle_soc_pct);
	await writeField(host, WALLBOX_EVCC_STATES.planActive, snap.plan_active);
	await writeField(host, WALLBOX_EVCC_STATES.planSocPct, snap.plan_soc_pct);
	await writeTimeField(host, WALLBOX_EVCC_STATES.planTime, snap.plan_time);
	await writeTimeField(host, WALLBOX_EVCC_STATES.effectivePlanTime, snap.effective_plan_time);
	await writeField(host, WALLBOX_EVCC_STATES.activePhases, snap.active_phases);
	await writeField(host, WALLBOX_EVCC_STATES.configuredPhases, snap.configured_phases);
	await writeField(host, WALLBOX_EVCC_STATES.minCurrentA, snap.min_current_a);
	await writeField(host, WALLBOX_EVCC_STATES.maxCurrentA, snap.max_current_a);
	await writeField(host, WALLBOX_EVCC_STATES.batteryMode, snap.battery_mode);
	await writeField(host, WALLBOX_EVCC_STATES.batteryDischargeControl, snap.battery_discharge_control);

	await refreshWallboxDailyPlanRuntime(host, snap);
}

function scheduleRefresh(host: WallboxHost): void {
	if (debounceTimer) clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		void refreshWallboxEvccTelemetry(host).catch((e) =>
			host.log.debug?.(`wallbox evcc refresh: ${e}`),
		);
	}, DEBOUNCE_MS);
}

export async function initWallboxModule(host: WallboxHost): Promise<void> {
	if (activeHost === host) return;
	activeHost = host;

	await ensureWallboxEvccStates(host);
	await ensureWallboxRuntimeStates(host);
	await refreshWallboxEvccTelemetry(host);

	const cfg = wallboxEvccTelemetryConfigFromAdapter(host.config);
	const ids = new Set(configuredEvccTelemetryStateIds(cfg));
	ids.add(addonEnabled(WALLBOX_ADDON_ID));
	ids.add(addonGovernanceEnabledState(WALLBOX_ADDON_ID));
	ids.add(GLOBAL.executionMode);
	ids.add(addonMode(WALLBOX_ADDON_ID));
	ids.add(DAILY_PLAN_STATE_IDS.revision);
	ids.add(DAILY_PLAN_STATE_IDS.status);
	ids.add(ALLOCATION_ADDON_STATE_IDS.wallbox.planJson);

	for (const id of ids) {
		if (subscribedIds.includes(id)) continue;
		const isForeign = !id.startsWith("addons.") && !id.startsWith("planner.");
		if (isForeign) {
			if (typeof host.subscribeForeignStatesAsync === "function") {
				try {
					await host.subscribeForeignStatesAsync(id);
					subscribedIds.push(id);
				} catch (e) {
					host.log.debug?.(`wallbox evcc subscribe ${id}: ${e}`);
				}
			}
		} else if (typeof host.subscribeStatesAsync === "function") {
			try {
				await host.subscribeStatesAsync(id);
				subscribedIds.push(id);
			} catch (e) {
				host.log.debug?.(`wallbox subscribe ${id}: ${e}`);
			}
		}
	}
	host.log.debug("Wallbox EVCC telemetry module initialized (read-only)");
}

export function stopWallboxModule(): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
	const host = activeHost;
	if (host) {
		if (typeof host.unsubscribeStatesAsync === "function") {
			for (const id of subscribedIds) {
				if (id.startsWith("addons.") || id.startsWith("planner.")) {
					void Promise.resolve(host.unsubscribeStatesAsync!(id)).catch(() => undefined);
				}
			}
		}
		if (typeof host.unsubscribeForeignStatesAsync === "function") {
			for (const id of subscribedIds) {
				if (!id.startsWith("addons.") && !id.startsWith("planner.")) {
					void Promise.resolve(host.unsubscribeForeignStatesAsync!(id)).catch(() => undefined);
				}
			}
		}
	}
	subscribedIds.length = 0;
	activeHost = null;
	resetWallboxDailyPlanCache();
	resetWallboxDispatchCache();
}

const DAILY_PLAN_TRIGGER_IDS = new Set([
	DAILY_PLAN_STATE_IDS.revision,
	DAILY_PLAN_STATE_IDS.status,
	ALLOCATION_ADDON_STATE_IDS.wallbox.planJson,
	addonEnabled(WALLBOX_ADDON_ID),
	addonGovernanceEnabledState(WALLBOX_ADDON_ID),
	GLOBAL.executionMode,
	addonMode(WALLBOX_ADDON_ID),
]);

export function handleWallboxForeignStateChange(namespace: string, id: string): void {
	if (!activeHost) return;
	const cfg = wallboxEvccTelemetryConfigFromAdapter(activeHost.config);
	const ids = configuredEvccTelemetryStateIds(cfg);
	if (ids.includes(id)) {
		scheduleRefresh(activeHost);
		return;
	}
	void namespace;
}

export function handleWallboxStateChange(namespace: string, id: string): void {
	if (!activeHost) return;
	const ns = `${namespace}.`;
	const bareId = id.startsWith(ns) ? id.slice(ns.length) : id;
	if (DAILY_PLAN_TRIGGER_IDS.has(bareId)) {
		scheduleRefresh(activeHost);
	}
}
