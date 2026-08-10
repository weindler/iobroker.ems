/**
 * Einspeisevergütung (ct/kWh): Admin-native kanonisch → Spiegel economics.config.feed_in_ct_per_kwh.
 * Planner liest weiterhin nur den State (unverändert). Keine Faktor-100-Umwandlung.
 */

import { setOptionalNumberIfChanged } from "../policy/core/state_write";
import { asNum, type StateHost } from "./state_util";

export const FEED_IN_CT_PER_KWH_NATIVE_KEY = "feed_in_ct_per_kwh";
export const FEED_IN_CT_PER_KWH_STATE = "economics.config.feed_in_ct_per_kwh";
export const FEED_IN_MIGRATED_V1_STATE = "economics.config.feed_in_migrated_v1";

export type EconomicsFeedInHost = StateHost & {
	config: unknown;
	updateConfig?: (newConfig: Record<string, unknown>) => Promise<unknown>;
	log?: { info?: (m: string) => void; warn?: (m: string) => void; debug?: (m: string) => void };
};

/** Gleiche Semantik wie Unified normalizeFeedInCtPerKwh — ct/kWh, >= 0, kein €-Faktor. */
export function normalizeFeedInCtPerKwhConfig(raw: unknown): number | null {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
	return raw;
}

export function readNativeFeedInCtPerKwh(config: unknown): number | null {
	if (!config || typeof config !== "object") return null;
	const raw = (config as Record<string, unknown>)[FEED_IN_CT_PER_KWH_NATIVE_KEY];
	return normalizeFeedInCtPerKwhConfig(raw);
}

async function ensureMigrationMarkerObject(host: StateHost): Promise<void> {
	await host.setObjectNotExistsAsync(FEED_IN_MIGRATED_V1_STATE, {
		type: "state",
		common: {
			name: "Economics Einspeisevergütung: Native-Migration v1",
			type: "boolean",
			role: "indicator",
			read: true,
			write: false,
			def: false,
		},
		native: {},
	} as ioBroker.Object);
}

/**
 * Einmalig: gültigen Altwert aus dem State in Admin-native übernehmen (falls native leer).
 * Danach immer native → State spiegeln (eine Wahrheit).
 */
export async function migrateAndSyncEconomicsFeedInFromConfig(
	host: EconomicsFeedInHost,
): Promise<{
	canonicalCtPerKwh: number | null;
	migratedFromState: boolean;
	mirrored: boolean;
}> {
	await ensureMigrationMarkerObject(host);
	const markerSt = await host.getStateAsync(FEED_IN_MIGRATED_V1_STATE);
	const alreadyMigrated = markerSt?.val === true;

	let nativeVal = readNativeFeedInCtPerKwh(host.config);
	const stateVal = normalizeFeedInCtPerKwhConfig(
		asNum((await host.getStateAsync(FEED_IN_CT_PER_KWH_STATE))?.val),
	);

	let migratedFromState = false;

	if (!alreadyMigrated) {
		if (nativeVal === null && stateVal !== null) {
			if (typeof host.updateConfig === "function") {
				const base =
					host.config && typeof host.config === "object"
						? ({ ...(host.config as Record<string, unknown>) } as Record<string, unknown>)
						: {};
				base[FEED_IN_CT_PER_KWH_NATIVE_KEY] = stateVal;
				await host.updateConfig(base);
				if (host.config && typeof host.config === "object") {
					(host.config as Record<string, unknown>)[FEED_IN_CT_PER_KWH_NATIVE_KEY] = stateVal;
				} else {
					host.config = base;
				}
				nativeVal = stateVal;
				migratedFromState = true;
				host.log?.info?.(
					`economics: migrated ${FEED_IN_CT_PER_KWH_STATE}=${stateVal} → native.${FEED_IN_CT_PER_KWH_NATIVE_KEY}`,
				);
			} else {
				/*
				 * Tests / Host ohne updateConfig: State vorerst behalten, Marker noch nicht setzen,
				 * damit ein späterer Sync mit leerem native den Altwert nicht löscht.
				 */
				host.log?.warn?.(
					`economics: feed_in Altwert ${stateVal} ct/kWh im State, aber updateConfig fehlt — Native nicht geschrieben`,
				);
			}
		}

		if (nativeVal !== null || stateVal === null || migratedFromState) {
			await host.setStateAsync(FEED_IN_MIGRATED_V1_STATE, { val: true, ack: true });
		}
	}

	const canonical = readNativeFeedInCtPerKwh(host.config);
	const markerNow = (await host.getStateAsync(FEED_IN_MIGRATED_V1_STATE))?.val === true;

	let mirrored = false;
	if (canonical !== null) {
		mirrored = await setOptionalNumberIfChanged(host, FEED_IN_CT_PER_KWH_STATE, canonical);
	} else if (markerNow) {
		/** Native bewusst leer → State auf null (Planner-Fallback), kein Fake-0. */
		mirrored = await setOptionalNumberIfChanged(host, FEED_IN_CT_PER_KWH_STATE, null);
	}
	/** else: Legacy-State unangetastet bis Migration möglich */

	return { canonicalCtPerKwh: canonical, migratedFromState, mirrored };
}

/** Nur Spiegelung native → State (z. B. EMS-Light-Tick nach Admin-Save/Restart). */
export async function syncEconomicsFeedInFromConfig(host: EconomicsFeedInHost): Promise<boolean> {
	const r = await migrateAndSyncEconomicsFeedInFromConfig(host);
	return r.mirrored;
}
