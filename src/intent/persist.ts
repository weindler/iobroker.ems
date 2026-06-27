import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ResolvedAllIntent } from "./core/aggregate";
import { buildResolvedAllIntent } from "./core/aggregate";
import type { ResolvedWallboxIntent, IobrokerIntentSnapshot } from "./wallbox/types";
import type { ResolvedThermalIntent, IobrokerThermalSnapshot } from "./thermal/types";
import { emptyResolvedThermalIntent } from "./thermal/types";
import type { ResolvedBatteryIntent, IobrokerBatterySnapshot } from "./battery/types";
import { emptyResolvedBatteryIntent } from "./battery/types";

export interface IntentPersistPayload {
	wallbox: ResolvedWallboxIntent;
	thermal: ResolvedThermalIntent;
	battery: ResolvedBatteryIntent;
	resolvedAll: ResolvedAllIntent;
	lastRequestIds: {
		wallbox: string | null;
		thermal: string | null;
		battery: string | null;
	};
	wallboxSnapshot: IobrokerIntentSnapshot | null;
	thermalSnapshot: IobrokerThermalSnapshot | null;
	batterySnapshot: IobrokerBatterySnapshot | null;
}

const PERSIST_FILE = "intent_v1.json";
const LEGACY_WALLBOX_FILE = "wallbox_intent_v1.json";

export async function writeIntentPersist(baseDir: string, payload: IntentPersistPayload): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	await fs.writeFile(
		path.join(baseDir, PERSIST_FILE),
		`${JSON.stringify(
			{
				module: "intent_v1",
				wallbox: payload.wallbox,
				thermal: payload.thermal,
				battery: payload.battery,
				resolved_all: payload.resolvedAll,
				last_request_ids: payload.lastRequestIds,
				wallbox_snapshot: payload.wallboxSnapshot,
				thermal_snapshot: payload.thermalSnapshot,
				battery_snapshot: payload.batterySnapshot,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
}

export async function readIntentPersist(baseDir: string): Promise<IntentPersistPayload | null> {
	const modern = await readModernPersist(path.join(baseDir, PERSIST_FILE));
	if (modern) return modern;
	return readLegacyWallboxPersist(path.join(baseDir, LEGACY_WALLBOX_FILE));
}

async function readModernPersist(filePath: string): Promise<IntentPersistPayload | null> {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		const parsed = JSON.parse(raw) as Partial<{
			wallbox: ResolvedWallboxIntent;
			thermal: ResolvedThermalIntent;
			battery: ResolvedBatteryIntent;
			resolved_all: ResolvedAllIntent;
			last_request_ids: IntentPersistPayload["lastRequestIds"];
			wallbox_snapshot: IobrokerIntentSnapshot | null;
			thermal_snapshot: IobrokerThermalSnapshot | null;
			battery_snapshot: IobrokerBatterySnapshot | null;
		}>;
		if (!parsed.wallbox) return null;
		return {
			wallbox: parsed.wallbox,
			thermal: parsed.thermal!,
			battery: parsed.battery!,
			resolvedAll: parsed.resolved_all!,
			lastRequestIds: parsed.last_request_ids ?? { wallbox: null, thermal: null, battery: null },
			wallboxSnapshot: parsed.wallbox_snapshot ?? null,
			thermalSnapshot: parsed.thermal_snapshot ?? null,
			batterySnapshot: parsed.battery_snapshot ?? null,
		};
	} catch {
		return null;
	}
}

async function readLegacyWallboxPersist(filePath: string): Promise<IntentPersistPayload | null> {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		const parsed = JSON.parse(raw) as {
			revision?: number;
			last_request_id?: string | null;
			resolved?: ResolvedWallboxIntent;
			iobroker_snapshot?: IobrokerIntentSnapshot | null;
		};
		if (!parsed.resolved) return null;
		const now = new Date();
		return {
			wallbox: parsed.resolved,
			thermal: emptyResolvedThermalIntent(now, "immersion_heater"),
			battery: emptyResolvedBatteryIntent(now, "main"),
			resolvedAll: buildResolvedAllIntent(null, { wallbox: parsed.resolved }, now),
			lastRequestIds: {
				wallbox: parsed.last_request_id ?? null,
				thermal: null,
				battery: null,
			},
			wallboxSnapshot: parsed.iobroker_snapshot ?? null,
			thermalSnapshot: null,
			batterySnapshot: null,
		};
	} catch {
		return null;
	}
}
