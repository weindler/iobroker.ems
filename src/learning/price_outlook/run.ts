import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";
import { intentAdminConfigFromAdapter } from "../../intent/config";
import { parseTibberPriceJsonTo15MinSlots } from "../price_forecast/tibber_parse";
import { priceOutlookConfigFromAdapter } from "./config";
import { buildLocalPvRawKwh, buildPriceOutlook } from "./math";
import {
	fetchBrightSkyLocation,
	fetchBrightSkyRegions,
	fetchSmardPriceHistory,
	type SmardCache,
	type WeatherCache,
} from "./sources";
import type { PriceOutlook } from "./types";

export type PriceOutlookHost = {
	config: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	getAbsolutePath?: (category?: string) => string;
	log: { debug?: (message: string) => void; warn: (message: string) => void; error: (message: string) => void };
};

async function readJson<T>(filePath: string): Promise<T | null> {
	try { return JSON.parse(await fs.readFile(filePath, "utf8")) as T; } catch { return null; }
}

async function resolveSystemLocation(host: PriceOutlookHost) {
	const cfg = priceOutlookConfigFromAdapter(host.config);
	let latitude = cfg.latitude;
	let longitude = cfg.longitude;
	let timezone = cfg.timezone || intentAdminConfigFromAdapter(host.config).timezone || "Europe/Berlin";
	if ((latitude === null || longitude === null || !cfg.timezone) && host.getForeignObjectAsync) {
		const system = await host.getForeignObjectAsync("system.config");
		const common = (system?.common ?? {}) as Record<string, unknown>;
		const native = (system?.native ?? {}) as Record<string, unknown>;
		const number = (value: unknown): number | null => {
			const parsed = typeof value === "number" ? value : Number(value);
			return Number.isFinite(parsed) ? parsed : null;
		};
		latitude ??= number(common.latitude ?? native.latitude);
		longitude ??= number(common.longitude ?? native.longitude);
		if (!cfg.timezone) timezone = String(common.timeZone ?? native.timezone ?? timezone);
	}
	return { cfg, latitude, longitude, timezone };
}

async function writeOutlook(host: PriceOutlookHost, outlook: PriceOutlook, error = "") {
	await host.setStateAsync("learning.price_outlook.status", { val: outlook.status, ack: true });
	await host.setStateAsync("learning.price_outlook.status_de", { val: outlook.statusDe, ack: true });
	await host.setStateAsync("learning.price_outlook.last_update", { val: outlook.generatedAtIso, ack: true });
	await host.setStateAsync("learning.price_outlook.horizon_json", { val: JSON.stringify(outlook), ack: true });
	await host.setStateAsync("learning.price_outlook.error", { val: error, ack: true });
	if (outlook.spread.expectedCtPerKwh !== null) {
		await host.setStateAsync("learning.price_outlook.spread_ct_per_kwh", { val: outlook.spread.expectedCtPerKwh, ack: true });
	}
	await host.setStateAsync("learning.price_outlook.spread_confidence_pct", { val: outlook.spread.confidencePct, ack: true });
}

async function persist(baseDir: string, outlook: PriceOutlook, smard: SmardCache | null, weather: WeatherCache | null) {
	await fs.mkdir(baseDir, { recursive: true });
	await atomicWriteFile(path.join(baseDir, "price_outlook_latest_v1.json"), `${JSON.stringify(outlook, null, 2)}\n`);
	if (smard) await atomicWriteFile(path.join(baseDir, "smard_price_cache_v1.json"), `${JSON.stringify(smard)}\n`);
	if (weather) await atomicWriteFile(path.join(baseDir, "brightsky_forecast_cache_v1.json"), `${JSON.stringify(weather)}\n`);
	const snapshots = path.join(baseDir, "snapshots");
	await fs.mkdir(snapshots, { recursive: true });
	const dayKey = outlook.generatedAtIso.slice(0, 10);
	const snapshotPath = path.join(snapshots, `${dayKey}.json`);
	try { await fs.access(snapshotPath); } catch { await atomicWriteFile(snapshotPath, `${JSON.stringify(outlook, null, 2)}\n`); }
	const cutoff = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
	for (const name of await fs.readdir(snapshots)) {
		if (/^\d{4}-\d{2}-\d{2}\.json$/.test(name) && name.slice(0, 10) < cutoff) await fs.unlink(path.join(snapshots, name));
	}
}

export async function runPriceOutlook(host: PriceOutlookHost, now = new Date()): Promise<void> {
	const { cfg, latitude, longitude, timezone } = await resolveSystemLocation(host);
	if (!cfg.enabled) {
		await host.setStateAsync("learning.price_outlook.status", { val: "disabled", ack: true });
		return;
	}
	const baseDir = host.getAbsolutePath?.("learning/price_outlook") ?? "";
	let smard = baseDir ? await readJson<SmardCache>(path.join(baseDir, "smard_price_cache_v1.json")) : null;
	let weather = baseDir ? await readJson<WeatherCache>(path.join(baseDir, "brightsky_forecast_cache_v1.json")) : null;
	let localWeather = baseDir ? await readJson<WeatherCache>(path.join(baseDir, "brightsky_local_cache_v1.json")) : null;
	let smardAvailable = false;
	let weatherAvailable = false;
	const errors: string[] = [];
	try { smard = await fetchSmardPriceHistory(smard, now.getTime()); smardAvailable = true; } catch (error) { errors.push(`SMARD: ${error instanceof Error ? error.message : String(error)}`); smardAvailable = Boolean(smard?.points.length); }
	try { weather = await fetchBrightSkyRegions(weather, now.getTime()); weatherAvailable = true; } catch (error) { errors.push(`Bright Sky: ${error instanceof Error ? error.message : String(error)}`); weatherAvailable = Boolean(weather?.regions.length); }
	if (latitude !== null && longitude !== null) {
		try { localWeather = await fetchBrightSkyLocation(latitude, longitude, localWeather, now.getTime()); } catch (error) { errors.push(`Bright Sky lokal: ${error instanceof Error ? error.message : String(error)}`); }
	}
	const read = async (id: string): Promise<unknown> => id ? (await host.getStateAsync(id))?.val : null;
	const tibber = [
		...parseTibberPriceJsonTo15MinSlots(await read(cfg.todayJsonStateId)),
		...parseTibberPriceJsonTo15MinSlots(await read(cfg.tomorrowJsonStateId)),
	];
	const outlook = buildPriceOutlook({
		now,
		timezone,
		tibber,
		smard: smard?.points ?? [],
		weather: weather?.regions ?? [],
		smardAvailable,
		weatherAvailable,
	});
	let pvKwp = cfg.pvKwp;
	if (pvKwp === null && host.getForeignStateAsync) {
		let sum = 0;
		let found = false;
		for (const id of cfg.pvKwpStateIds) {
			const value = Number((await host.getForeignStateAsync(id))?.val);
			if (Number.isFinite(value) && value > 0) { sum += value; found = true; }
		}
		if (found) pvKwp = sum;
	}
	const localPvRaw = localWeather && pvKwp !== null && pvKwp > 0
		? buildLocalPvRawKwh({ weather: localWeather.regions, pvKwp, timezone, now })
		: Array<number | null>(7).fill(null);
	await host.setStateAsync("learning.price_outlook.local_pv_raw_json", { val: JSON.stringify(localPvRaw), ack: true });
	for (let index = 0; index < localPvRaw.length; index++) {
		await host.setStateAsync(`learning.price_outlook.local_pv_day${index + 1}_raw_kwh`, { val: localPvRaw[index], ack: true });
	}
	if (errors.length) {
		outlook.status = outlook.status === "unavailable" ? "unavailable" : "degraded";
		outlook.statusDe = errors.join(" ");
	}
	await writeOutlook(host, outlook, errors.join(" | "));
	if (baseDir) await persist(baseDir, outlook, smard, weather);
	if (baseDir && localWeather) await atomicWriteFile(path.join(baseDir, "brightsky_local_cache_v1.json"), `${JSON.stringify(localWeather)}\n`);
	host.log.debug?.(`Sieben-Tage-Preisprognose: ${outlook.status}, ${outlook.days.length} Tage`);
}
