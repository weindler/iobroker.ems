import type { TelemetryField } from "../normalize";
import { normalizeOptionalSoc } from "../normalize";
import type { EvccTelemetrySnapshot } from "../evcc_telemetry";
import type { VehicleSocSource, VehicleTelemetryValues, WallboxVehicleProfile } from "./types";

const STALE_MS = 15 * 60 * 1000;

function fieldFromRawBool(raw: unknown): boolean | null {
	if (typeof raw === "boolean") return raw;
	if (typeof raw === "number") return raw !== 0;
	const s = String(raw ?? "").trim().toLowerCase();
	if (["1", "true", "on", "yes", "ja"].includes(s)) return true;
	if (["0", "false", "off", "no", "nein"].includes(s)) return false;
	return null;
}

function fieldFromRawNumber(raw: unknown): number | null {
	if (raw === null || raw === undefined || raw === "") return null;
	const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
	return Number.isFinite(n) ? n : null;
}

function socFromRaw(raw: unknown): number | null {
	const f = normalizeOptionalSoc(raw);
	return f.status === "valid" ? f.value : null;
}

function isStale(ts: number | undefined, nowMs: number): boolean {
	if (ts === undefined || !Number.isFinite(ts)) return false;
	return nowMs - ts > STALE_MS;
}

export { STALE_MS };

/** Per-field stale check — missing timestamp is treated as stale. */
export function isFieldStale(ts: number | undefined, nowMs: number): boolean {
	if (ts === undefined || !Number.isFinite(ts)) return true;
	return nowMs - ts > STALE_MS;
}

export interface ProfileTelemetryReadings {
	connected: boolean | null;
	charging: boolean | null;
	socPct: number | null;
	rangeKm: number | null;
	sessionEnergyKwh: number | null;
	socFromConfiguredState: boolean;
	connectedFromConfiguredState: boolean;
	lastUpdate: string | null;
	stale: boolean;
	socTs?: number;
	rangeTs?: number;
	sessionEnergyTs?: number;
}

export function mergeProfileTelemetryReadings(
	profile: WallboxVehicleProfile,
	readings: ProfileTelemetryReadings,
	evccSnap: EvccTelemetrySnapshot | null,
	isResolvedProfile: boolean,
	evccConnected: boolean,
	now: Date,
): VehicleTelemetryValues {
	const nowMs = now.getTime();
	let connected = readings.connected;
	let charging = readings.charging;
	let socPct = readings.socPct;
	let rangeKm = readings.rangeKm;
	let sessionEnergyKwh = readings.sessionEnergyKwh;
	let socSource: VehicleSocSource = "unavailable";
	let socQuality: string | null = null;

	const useEvccTelemetry =
		evccSnap !== null &&
		isResolvedProfile &&
		evccConnected &&
		(profile.source === "evcc" || profile.source === "hybrid");

	if (useEvccTelemetry) {
		if (connected === null) {
			const f = evccSnap!.connected;
			if (f.status === "valid" && typeof f.value === "boolean") connected = f.value;
		}
		if (charging === null) {
			const f = evccSnap!.charging;
			if (f.status === "valid" && typeof f.value === "boolean") charging = f.value;
		}
		if (socPct === null) {
			const f = evccSnap!.vehicle_soc_pct;
			if (f.status === "valid" && typeof f.value === "number") {
				socPct = f.value;
				socSource = "evcc_estimated";
				socQuality = "evcc";
			}
		}
		if (sessionEnergyKwh === null) {
			const f = evccSnap!.session_energy_kwh;
			if (f.status === "valid" && typeof f.value === "number") sessionEnergyKwh = f.value;
		}
	}

	if (isResolvedProfile && connected === null && evccSnap) {
		const f = evccSnap.connected;
		if (f.status === "valid" && typeof f.value === "boolean") connected = f.value;
	}
	if (isResolvedProfile && charging === null && evccSnap) {
		const f = evccSnap.charging;
		if (f.status === "valid" && typeof f.value === "boolean") charging = f.value;
	}

	if (readings.socFromConfiguredState && readings.socPct !== null) {
		socSource = "measured";
		socQuality = readings.stale ? "stale" : "measured";
	} else if (socPct !== null && socSource === "unavailable") {
		socSource = useEvccTelemetry ? "evcc_estimated" : "measured";
		socQuality = useEvccTelemetry ? "evcc" : "measured";
	}

	if (socPct === null) {
		socSource = "unavailable";
		socQuality = null;
	}

	return {
		connected,
		charging,
		socPct,
		socSource,
		socQuality,
		rangeKm,
		sessionEnergyKwh,
		lastUpdate: readings.lastUpdate ?? now.toISOString(),
		stale: readings.stale,
	};
}

export function profileTelemetryFromForeignReads(
	profile: WallboxVehicleProfile,
	reads: {
		soc?: { val: unknown; ts?: number };
		range?: { val: unknown; ts?: number };
		connected?: { val: unknown; ts?: number };
		charging?: { val: unknown; ts?: number };
		sessionEnergy?: { val: unknown; ts?: number };
	},
	now: Date,
): ProfileTelemetryReadings {
	const nowMs = now.getTime();
	const tsValues = [
		reads.soc?.ts,
		reads.range?.ts,
		reads.connected?.ts,
		reads.charging?.ts,
		reads.sessionEnergy?.ts,
	].filter((t): t is number => t !== undefined && Number.isFinite(t));
	const latestTs = tsValues.length ? Math.max(...tsValues) : undefined;
	const stale = isStale(latestTs, nowMs);

	return {
		connected: reads.connected ? fieldFromRawBool(reads.connected.val) : null,
		charging: reads.charging ? fieldFromRawBool(reads.charging.val) : null,
		socPct: reads.soc ? socFromRaw(reads.soc.val) : null,
		rangeKm: reads.range ? fieldFromRawNumber(reads.range.val) : null,
		sessionEnergyKwh: reads.sessionEnergy ? fieldFromRawNumber(reads.sessionEnergy.val) : null,
		socFromConfiguredState: Boolean(profile.socStateId && reads.soc),
		connectedFromConfiguredState: Boolean(profile.connectedStateId && reads.connected),
		lastUpdate: latestTs ? new Date(latestTs).toISOString() : null,
		stale,
		socTs: reads.soc?.ts,
		rangeTs: reads.range?.ts,
		sessionEnergyTs: reads.sessionEnergy?.ts,
	};
}

export function emptyProfileTelemetry(now: Date): VehicleTelemetryValues {
	return {
		connected: null,
		charging: null,
		socPct: null,
		socSource: "unavailable",
		socQuality: null,
		rangeKm: null,
		sessionEnergyKwh: null,
		lastUpdate: now.toISOString(),
		stale: false,
	};
}

export function pickEvccField<T>(field: TelemetryField<T>): T | null {
	if (field.status === "valid") return field.value;
	return null;
}
