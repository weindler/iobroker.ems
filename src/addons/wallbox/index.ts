import {
	configuredEvccTelemetryStateIds,
	wallboxEvccTelemetryConfigFromAdapter,
} from "./evcc_config";
import { ensureWallboxEvccStates, WALLBOX_EVCC_STATES } from "./ensure_evcc_states";
import { readEvccTelemetrySnapshot, type EvccTelemetryReadHost } from "./evcc_telemetry";
import type { TelemetryField } from "./normalize";

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
	await refreshWallboxEvccTelemetry(host);

	const cfg = wallboxEvccTelemetryConfigFromAdapter(host.config);
	const ids = configuredEvccTelemetryStateIds(cfg);
	for (const id of ids) {
		if (subscribedIds.includes(id)) continue;
		if (typeof host.subscribeForeignStatesAsync === "function") {
			try {
				// Kein Callback übergeben: ioBroker interpretiert eine Funktion als
				// internen Completion-Callback, wodurch das Promise nie auflöst.
				// Foreign-Änderungen laufen über onStateChange -> handleWallboxForeignStateChange.
				await host.subscribeForeignStatesAsync(id);
				subscribedIds.push(id);
			} catch (e) {
				host.log.debug?.(`wallbox evcc subscribe ${id}: ${e}`);
			}
		}
	}
	host.log.info("Wallbox EVCC telemetry module initialized (read-only)");
}

export function stopWallboxModule(): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
	const host = activeHost;
	if (host && typeof host.unsubscribeForeignStatesAsync === "function") {
		for (const id of subscribedIds) {
			void Promise.resolve(host.unsubscribeForeignStatesAsync!(id)).catch(() => undefined);
		}
	}
	subscribedIds.length = 0;
	activeHost = null;
}

export function handleWallboxForeignStateChange(namespace: string, id: string): void {
	if (!activeHost) return;
	const cfg = wallboxEvccTelemetryConfigFromAdapter(activeHost.config);
	const ids = configuredEvccTelemetryStateIds(cfg);
	if (ids.includes(id)) {
		scheduleRefresh(activeHost);
	}
	void namespace;
}
