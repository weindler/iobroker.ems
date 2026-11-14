import type { StateHost } from "../../ems_light/state_util";
import { EnergyforecastHttpError, fetchEnergyforecast } from "./client";
import { compareSnapshots, type EfSnapshot } from "./compare";
import {
	addFetchToSnapshots,
	readBiasHistory,
	readCache,
	readSnapshots,
	writeBiasHistory,
	writeCache,
	writeSnapshots,
	type EfCache,
} from "./persist";
import {
	biasDaysAvailable,
	BIAS_MIN_DAYS,
	dayHourBiases,
	dayTypeOf,
	estimateBiasCt,
	mergeBiasHistory,
	type DayHourBias,
} from "./bias_model";
import { fullDaysAhead, localDay, parseEnergyforecastResponse, redactToken, slotAt, type EfSlot } from "./parse";
import type { Price15MinSlot } from "../price_forecast/tibber_parse";

/** Erfolgreicher Abruf: alle 6 h (die Quelle aktualisiert zweimal täglich, Free-Tarif: 50 Abrufe/Tag). */
export const EF_FETCH_INTERVAL_MS = 6 * 3_600_000 - 10 * 60_000;
/** Nach Fehlern frühestens nach 55 Minuten wieder; bei Tageslimit (429) 6 Stunden. */
export const EF_RETRY_MS = 55 * 60_000;
export const EF_RETRY_429_MS = 6 * 3_600_000;

export type EnergyforecastConfig = { enabled: boolean; token: string };

export function energyforecastConfigFromAdapter(config: unknown): EnergyforecastConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const e = c.energyforecast_enabled;
	const enabled = e === true || e === "true" || e === 1 || e === "1";
	const token = typeof c.energyforecast_token === "string" ? c.energyforecast_token.trim() : "";
	return { enabled, token };
}

export function fetchDue(cache: EfCache, nowMs: number): boolean {
	if (!cache.fetchedAtIso && cache.lastAttemptMs === 0) return true;
	const sinceAttempt = nowMs - cache.lastAttemptMs;
	if (cache.lastError) {
		return sinceAttempt >= (cache.lastErrorStatus === 429 ? EF_RETRY_429_MS : EF_RETRY_MS);
	}
	return sinceAttempt >= EF_FETCH_INTERVAL_MS;
}

export type EnergyforecastHost = StateHost & {
	config: unknown;
	getAbsolutePath?: (category?: string) => string;
	log: { info: (m: string) => void; debug?: (m: string) => void; warn: (m: string) => void };
};

async function setState(host: EnergyforecastHost, id: string, val: ioBroker.StateValue): Promise<void> {
	await host.setStateAsync(`learning.energyforecast.${id}`, { val, ack: true });
}

let comparedOnce = false;
let memorySlots: EfSlot[] = [];
let memoryFrozen: ReadonlyMap<number, number> = new Map();
let memoryBias: DayHourBias[] = [];

function localHourBerlin(ms: number): number {
	return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(new Date(ms))) % 24;
}

/** Je Viertelstunde die zuletzt festgehaltene Prognose (ct/kWh) — für den Vergleich mit dem echten Preis. */
export function frozenForecastFromSnapshots(snapshots: EfSnapshot[]): Map<number, number> {
	const out = new Map<number, number>();
	for (const snap of [...snapshots].sort((a, b) => a.atMs - b.atMs)) {
		for (const [start, ct] of snap.slots) out.set(start, ct);
	}
	return out;
}

export function getEnergyforecastFrozenForecast(): ReadonlyMap<number, number> {
	return memoryFrozen;
}

/**
 * Preis-Slots für die Planung (Gesamtpreis ct/kWh, ab `fromMs`). Leer, solange Energyforecast aus ist,
 * kein Token da ist oder noch nichts abgerufen wurde. Prognose-Slots tragen `origin: "forecast"`.
 */
export function getEnergyforecastPrice15MinSlots(fromMs: number): Price15MinSlot[] {
	const out: Price15MinSlot[] = [];
	for (const s of memorySlots) {
		if (s.startMs < fromMs) continue;
		let price = s.totalCt;
		if (s.origin === "forecast") {
			// Gelernte Verzerrung abziehen (erst ab genug verglichenen Tagen, je Stunde und Tagestyp).
			const date = localDay(s.startMs);
			const lead = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${localDay(fromMs)}T12:00:00Z`)) / 86_400_000);
			const bias = estimateBiasCt(memoryBias, localHourBerlin(s.startMs), dayTypeOf(date), lead);
			if (bias !== null) price -= bias;
		}
		const slot: Price15MinSlot = { slotStartMs: s.startMs, priceCtPerKwh: Math.round(price * 1000) / 1000 };
		if (s.origin === "forecast") slot.origin = "forecast";
		out.push(slot);
	}
	return out;
}

export async function runEnergyforecast(
	host: EnergyforecastHost,
	nowMs = Date.now(),
	fetchFn?: Parameters<typeof fetchEnergyforecast>[1],
): Promise<void> {
	const cfg = energyforecastConfigFromAdapter(host.config);
	if (!cfg.enabled) {
		memorySlots = [];
		await setState(host, "status", "disabled");
		await setState(host, "status_de", "Energyforecast im Admin nicht aktiviert.");
		return;
	}
	if (!cfg.token) {
		memorySlots = [];
		await setState(host, "status", "no_token");
		await setState(host, "status_de", "Energyforecast aktiviert, aber kein API-Token eingetragen.");
		return;
	}
	if (typeof host.getAbsolutePath !== "function") return;
	const dir = host.getAbsolutePath("learning/energyforecast");

	let cache = await readCache(dir);
	let fetched = false;
	if (fetchDue(cache, nowMs)) {
		cache = { ...cache, lastAttemptMs: nowMs };
		try {
			const parsed = parseEnergyforecastResponse(await fetchEnergyforecast(cfg.token, fetchFn));
			if (parsed.slots.length === 0) throw new Error("Antwort ohne gültige Preise");
			cache = {
				version: 1,
				fetchedAtIso: new Date(nowMs).toISOString(),
				lastAttemptMs: nowMs,
				lastError: null,
				lastErrorStatus: null,
				plan: parsed.plan,
				generatedAtIso: parsed.generatedAtIso,
				validUntilIso: parsed.validUntilIso,
				slots: parsed.slots,
			};
			await writeCache(dir, cache);
			await writeSnapshots(dir, addFetchToSnapshots(await readSnapshots(dir), parsed, nowMs));
			fetched = true;
			host.log.debug?.(`Energyforecast: ${parsed.slots.length} Slots, Tarif ${parsed.plan ?? "?"}.`);
		} catch (e) {
			const msg = redactToken(e instanceof Error ? e.message : String(e), cfg.token);
			cache = {
				...cache,
				lastError: msg,
				lastErrorStatus: e instanceof EnergyforecastHttpError ? e.status : null,
			};
			await writeCache(dir, cache);
			host.log.warn(`Energyforecast-Abruf fehlgeschlagen: ${msg}`);
		}
	}

	memorySlots = cache.slots;
	if (cache.lastError) {
		await setState(host, "status", "error");
		await setState(host, "status_de", `Abruf fehlgeschlagen: ${cache.lastError}`);
	} else if (cache.fetchedAtIso) {
		await setState(host, "status", "ok");
		await setState(host, "status_de", `Letzter Abruf ${cache.fetchedAtIso}.`);
	}
	if (cache.plan !== null) await setState(host, "plan", cache.plan);
	if (cache.slots.length > 0) {
		await setState(host, "days_ahead", fullDaysAhead(cache.slots, nowMs));
		const cur = slotAt(cache.slots, nowMs);
		if (cur) await setState(host, "price_now", Math.round(cur.totalCt * 100) / 100);
	}

	if (fetched || !comparedOnce) {
		comparedOnce = true;
		const file = await readSnapshots(dir);
		memoryFrozen = frozenForecastFromSnapshots(file.snapshots);
		memoryBias = mergeBiasHistory(await readBiasHistory(dir), dayHourBiases(file.snapshots, file.actual), nowMs);
		await writeBiasHistory(dir, memoryBias);
		const result = compareSnapshots(file.snapshots, file.actual);
		await setState(
			host,
			"compare_json",
			JSON.stringify({
				updatedIso: new Date(nowMs).toISOString(),
				snapshots: file.snapshots.length,
				...result,
				correction: {
					active: biasDaysAvailable(memoryBias, 1) >= BIAS_MIN_DAYS,
					days: biasDaysAvailable(memoryBias, 1),
					minDays: BIAS_MIN_DAYS,
				},
			}),
		);
	}
}

/** Nur für Tests. */
export function resetEnergyforecastRunState(): void {
	comparedOnce = false;
	memorySlots = [];
	memoryFrozen = new Map();
	memoryBias = [];
}
