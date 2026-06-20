import { asNum } from "../../ems_light/state_util";
import type { ForecastFreezeDecision, ForecastFreezeSnapshot, PvBiasConfig } from "./types";
import { parseFreezeTimeHHMM } from "./config";

export const FROZEN_TODAY_STATE_ID = "learning.pv_bias.frozen_today_kwh";
export const FROZEN_TOMORROW_STATE_ID = "learning.pv_bias.frozen_tomorrow_kwh";

export type ForecastFreezeHost = {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	log: { info: (msg: string) => void; warn: (msg: string) => void };
};

/** Lokales Kalenderdatum YYYY-MM-DD. */
export function localDateKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Zeitpunkt des Freeze heute (lokale Zeit) in ms. */
export function freezeInstantMs(freezeTime: string, ref: Date): number | null {
	const parsed = parseFreezeTimeHHMM(freezeTime);
	if (!parsed) {
		return null;
	}
	const d = new Date(ref);
	d.setHours(parsed.hours, parsed.minutes, 0, 0);
	return d.getTime();
}

/**
 * Entscheidet, ob ein neuer Forecast-Snapshot erstellt werden soll.
 * Maximal ein Freeze pro Kalendertag; Neustart ändert nichts, wenn heute bereits eingefroren.
 */
export function decideForecastFreeze(
	now: Date,
	freezeEnabled: boolean,
	configuredFreezeTime: string,
	frozenAtTs: string | null,
): ForecastFreezeDecision {
	if (!freezeEnabled) {
		return {
			shouldFreeze: false,
			status: "disabled",
			reason: "Forecast-Freeze in Admin deaktiviert.",
		};
	}

	const freezeMs = freezeInstantMs(configuredFreezeTime, now);
	if (freezeMs === null) {
		return {
			shouldFreeze: false,
			status: "error",
			reason: `Ungültige Freeze-Zeit: ${configuredFreezeTime}`,
		};
	}

	if (now.getTime() < freezeMs) {
		return {
			shouldFreeze: false,
			status: "waiting",
			reason: `Warte auf Freeze um ${configuredFreezeTime}.`,
		};
	}

	if (frozenAtTs) {
		const frozenAt = new Date(frozenAtTs);
		if (!Number.isNaN(frozenAt.getTime()) && localDateKey(frozenAt) === localDateKey(now)) {
			return {
				shouldFreeze: false,
				status: "ready",
				reason: `Forecast bereits um ${frozenAtTs} eingefroren.`,
			};
		}
	}

	return {
		shouldFreeze: true,
		status: "waiting",
		reason: `Erstelle Forecast-Snapshot (${configuredFreezeTime}).`,
	};
}

/** Validiert Live-Forecast vor dem Freeze — fehlende Werte → kein Snapshot, kein 0. */
export function buildFreezeSnapshot(
	now: Date,
	freezeTime: string,
	frozenTodayKwh: number | null,
	frozenTomorrowKwh: number | null,
	frozenSource: string,
): { ok: true; snapshot: ForecastFreezeSnapshot } | { ok: false; reason: string } {
	if (frozenTodayKwh === null || !Number.isFinite(frozenTodayKwh)) {
		return { ok: false, reason: "Rohforecast heute fehlt — kein Freeze-Snapshot." };
	}
	if (frozenTodayKwh <= 0) {
		return { ok: false, reason: "Rohforecast heute ungültig (≤ 0) — kein Freeze-Snapshot." };
	}

	const tomorrow =
		frozenTomorrowKwh !== null && Number.isFinite(frozenTomorrowKwh) && frozenTomorrowKwh > 0
			? frozenTomorrowKwh
			: null;

	return {
		ok: true,
		snapshot: {
			frozenAtTs: now.toISOString(),
			freezeTime,
			frozenTodayKwh,
			frozenTomorrowKwh: tomorrow,
			frozenSource,
		},
	};
}

async function readForeignNum(host: ForecastFreezeHost, stateId: string): Promise<number | null> {
	if (!stateId) {
		return null;
	}
	try {
		const read = host.getForeignStateAsync ?? host.getStateAsync;
		const st = await read.call(host, stateId);
		return asNum(st?.val);
	} catch {
		return null;
	}
}

async function readLiveRawForecast(
	host: ForecastFreezeHost,
	cfg: PvBiasConfig,
): Promise<{ today: number | null; tomorrow: number | null; source: string }> {
	const fromTodayConfig = await readForeignNum(host, cfg.rawTodayStateId);
	if (fromTodayConfig !== null) {
		const tomorrow = await readForeignNum(host, cfg.rawTomorrowStateId);
		return { today: fromTodayConfig, tomorrow, source: cfg.rawTodayStateId };
	}

	const localToday = await host.getStateAsync("forecast.pv.today_kwh");
	const today = asNum(localToday?.val);
	if (today !== null) {
		const localTomorrow = await host.getStateAsync("forecast.pv.tomorrow_kwh");
		return {
			today,
			tomorrow: asNum(localTomorrow?.val),
			source: "forecast.pv.today_kwh",
		};
	}

	return { today: null, tomorrow: null, source: "—" };
}

async function setNumIfValid(host: ForecastFreezeHost, id: string, value: number | null): Promise<void> {
	if (value !== null && Number.isFinite(value)) {
		await host.setStateAsync(id, { val: Math.round(value * 1000) / 1000, ack: true });
	}
}

async function writeFreezeMeta(host: ForecastFreezeHost, status: string, reason: string): Promise<void> {
	await host.setStateAsync("learning.pv_bias.freeze_status", { val: status, ack: true });
	await host.setStateAsync("learning.pv_bias.freeze_reason", { val: reason, ack: true });
}

/** Snapshot nur zum konfigurierten Freeze-Zeitpunkt — danach unverändert bis zum nächsten Tag. */
export async function runForecastFreeze(host: ForecastFreezeHost, cfg: PvBiasConfig): Promise<void> {
	await host.setStateAsync("learning.pv_bias.freeze_time", { val: cfg.freezeTime, ack: true });

	const frozenAtSt = await host.getStateAsync("learning.pv_bias.frozen_at_ts");
	const frozenAtTs = typeof frozenAtSt?.val === "string" ? frozenAtSt.val : null;

	const decision = decideForecastFreeze(new Date(), cfg.freezeEnabled, cfg.freezeTime, frozenAtTs);

	if (!cfg.freezeEnabled) {
		await writeFreezeMeta(host, decision.status, decision.reason);
		return;
	}

	if (!decision.shouldFreeze) {
		await writeFreezeMeta(host, decision.status, decision.reason);
		return;
	}

	const live = await readLiveRawForecast(host, cfg);
	const built = buildFreezeSnapshot(
		new Date(),
		cfg.freezeTime,
		live.today,
		live.tomorrow,
		live.source,
	);

	if (!built.ok) {
		host.log.warn(`PV-Bias Freeze: ${built.reason}`);
		await writeFreezeMeta(host, "error", built.reason);
		return;
	}

	const snap = built.snapshot;
	await setNumIfValid(host, FROZEN_TODAY_STATE_ID, snap.frozenTodayKwh);
	await setNumIfValid(host, FROZEN_TOMORROW_STATE_ID, snap.frozenTomorrowKwh);
	await host.setStateAsync("learning.pv_bias.frozen_at_ts", { val: snap.frozenAtTs, ack: true });
	await host.setStateAsync("learning.pv_bias.frozen_source", { val: snap.frozenSource, ack: true });
	await writeFreezeMeta(host, "ready", `Forecast-Snapshot um ${snap.frozenAtTs} erstellt.`);
	host.log.info(`PV-Bias Freeze: today=${snap.frozenTodayKwh} kWh source=${snap.frozenSource}`);
}

export async function readFrozenForecast(
	host: ForecastFreezeHost,
): Promise<{ today: number | null; tomorrow: number | null }> {
	const todaySt = await host.getStateAsync(FROZEN_TODAY_STATE_ID);
	const tomorrowSt = await host.getStateAsync(FROZEN_TOMORROW_STATE_ID);
	return {
		today: asNum(todaySt?.val),
		tomorrow: asNum(tomorrowSt?.val),
	};
}
