import { asNum } from "../../../ems_light/state_util";
import { weatherConfigFromAdapter } from "../config";
import { weatherHorizonConfigFromAdapter, weatherHorizonHasAnyMapping } from "./config";
import type { WeatherHorizonDayQuality } from "./config";
import { WEATHER_HORIZON_DAY_INDEXES } from "./constants";
import { weatherHorizonDayStatePrefix } from "./ensure_states";
import { correctHorizonTempC, dailyTempBiasSample, emaBiasC } from "./math";

export type WeatherHorizonRunHost = {
	config: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	log: {
		info: (msg: string) => void;
		debug?: (msg: string) => void;
		warn: (msg: string) => void;
	};
};

async function readOwnNum(host: WeatherHorizonRunHost, id: string): Promise<number | null> {
	try {
		const st = await host.getStateAsync(id);
		return asNum(st?.val);
	} catch {
		return null;
	}
}

async function readOwnStr(host: WeatherHorizonRunHost, id: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(id);
		return typeof st?.val === "string" && st.val.trim() ? st.val.trim() : null;
	} catch {
		return null;
	}
}

async function readForeignNum(host: WeatherHorizonRunHost, id: string): Promise<number | null> {
	if (!id) return null;
	try {
		const reader = host.getForeignStateAsync ?? host.getStateAsync;
		const st = await reader(id);
		return asNum(st?.val);
	} catch {
		return null;
	}
}

async function setNumOrClear(host: WeatherHorizonRunHost, id: string, value: number | null): Promise<void> {
	if (value !== null && Number.isFinite(value)) {
		await host.setStateAsync(id, { val: Math.round(value * 100) / 100, ack: true });
	} else {
		await host.setStateAsync(id, { val: null, ack: true });
	}
}

function dayQuality(min: number | null, max: number | null, mapped: boolean): WeatherHorizonDayQuality {
	if (!mapped) return "missing";
	if (min !== null && max !== null) return "valid";
	if (min !== null || max !== null) return "degraded";
	return "missing";
}

function localDateKey(now = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/**
 * Tag-1 Forecast einfrieren und am Folgetag mit beobachtetem Ist-Min/Max vergleichen → Bias EMA.
 * Fallback: learning.weather.temp_bias_c für Min und Max, wenn noch kein Horizon-Bias.
 */
async function resolveAndUpdateBias(
	host: WeatherHorizonRunHost,
	todayKey: string,
	day1RawMin: number | null,
	day1RawMax: number | null,
	liveOutdoorC: number | null,
): Promise<{ minBiasC: number | null; maxBiasC: number | null; biasSource: string }> {
	const freezeDate = await readOwnStr(host, "learning.weather.horizon.freeze_date");
	const freezeMin = await readOwnNum(host, "learning.weather.horizon.freeze_min_temp_c");
	const freezeMax = await readOwnNum(host, "learning.weather.horizon.freeze_max_temp_c");
	const observedDate = await readOwnStr(host, "learning.weather.horizon.observed_date");
	let observedMin = await readOwnNum(host, "learning.weather.horizon.observed_min_temp_c");
	let observedMax = await readOwnNum(host, "learning.weather.horizon.observed_max_temp_c");
	let minBias = await readOwnNum(host, "learning.weather.horizon.min_bias_c");
	let maxBias = await readOwnNum(host, "learning.weather.horizon.max_bias_c");
	let biasSource = (await readOwnStr(host, "learning.weather.horizon.bias_source")) || "none";

	// Tageswechsel: Freeze vs. beobachtetes Ist desselben Freeze-Tages → Bias lernen
	if (
		freezeDate &&
		freezeDate < todayKey &&
		observedDate === freezeDate &&
		((freezeMin !== null && observedMin !== null) || (freezeMax !== null && observedMax !== null))
	) {
		if (freezeMin !== null && observedMin !== null) {
			minBias = emaBiasC(minBias, dailyTempBiasSample(observedMin, freezeMin));
		}
		if (freezeMax !== null && observedMax !== null) {
			maxBias = emaBiasC(maxBias, dailyTempBiasSample(observedMax, freezeMax));
		}
		biasSource = "day1_freeze_vs_observed";
		await setNumOrClear(host, "learning.weather.horizon.min_bias_c", minBias);
		await setNumOrClear(host, "learning.weather.horizon.max_bias_c", maxBias);
		await host.setStateAsync("learning.weather.horizon.bias_source", { val: biasSource, ack: true });
		host.log.info(
			`Weather-Horizon bias updated from ${freezeDate}: min=${minBias ?? "n/a"} max=${maxBias ?? "n/a"}`,
		);
	}

	// Live-Ist Min/Max für heute fortgeschrieben (für morgen Lernen)
	if (liveOutdoorC !== null && Number.isFinite(liveOutdoorC)) {
		if (observedDate !== todayKey) {
			observedMin = liveOutdoorC;
			observedMax = liveOutdoorC;
			await host.setStateAsync("learning.weather.horizon.observed_date", { val: todayKey, ack: true });
		} else {
			observedMin = observedMin === null ? liveOutdoorC : Math.min(observedMin, liveOutdoorC);
			observedMax = observedMax === null ? liveOutdoorC : Math.max(observedMax, liveOutdoorC);
		}
		await setNumOrClear(host, "learning.weather.horizon.observed_min_temp_c", observedMin);
		await setNumOrClear(host, "learning.weather.horizon.observed_max_temp_c", observedMax);
	}

	// Tag-1 Forecast einmal pro Kalendertag einfrieren
	if (freezeDate !== todayKey && (day1RawMin !== null || day1RawMax !== null)) {
		await host.setStateAsync("learning.weather.horizon.freeze_date", { val: todayKey, ack: true });
		await setNumOrClear(host, "learning.weather.horizon.freeze_min_temp_c", day1RawMin);
		await setNumOrClear(host, "learning.weather.horizon.freeze_max_temp_c", day1RawMax);
	}

	// Fallback: allgemeiner Temp-Bias aus Weather-Learning
	if (minBias === null && maxBias === null) {
		const legacy = await readOwnNum(host, "learning.weather.temp_bias_c");
		if (legacy !== null) {
			minBias = legacy;
			maxBias = legacy;
			biasSource = "learning.weather.temp_bias_c";
			await setNumOrClear(host, "learning.weather.horizon.min_bias_c", minBias);
			await setNumOrClear(host, "learning.weather.horizon.max_bias_c", maxBias);
			await host.setStateAsync("learning.weather.horizon.bias_source", { val: biasSource, ack: true });
		}
	}

	return { minBiasC: minBias, maxBiasC: maxBias, biasSource };
}

/**
 * BrightSky (o. ä.) Tages-Min/Max Tag 1–7 → raw + bias-korrigiert.
 * Unmapped/unlesbar → null / quality missing — nie Fake-0.
 */
export async function runWeatherHorizon(host: WeatherHorizonRunHost): Promise<void> {
	const cfg = weatherHorizonConfigFromAdapter(host.config);
	if (!cfg.enabled) {
		await host.setStateAsync("learning.weather.horizon.status", { val: "disabled", ack: true });
		return;
	}
	if (!weatherHorizonHasAnyMapping(cfg)) {
		await host.setStateAsync("learning.weather.horizon.status", { val: "no_mapping", ack: true });
		await host.setStateAsync("learning.weather.horizon.days_available", { val: 0, ack: true });
		for (const day of WEATHER_HORIZON_DAY_INDEXES) {
			const prefix = weatherHorizonDayStatePrefix(day);
			await setNumOrClear(host, `${prefix}.raw_min_temp_c`, null);
			await setNumOrClear(host, `${prefix}.raw_max_temp_c`, null);
			await setNumOrClear(host, `${prefix}.min_temp_c`, null);
			await setNumOrClear(host, `${prefix}.max_temp_c`, null);
			await host.setStateAsync(`${prefix}.quality`, { val: "missing", ack: true });
		}
		return;
	}

	const weatherCfg = weatherConfigFromAdapter(host.config);
	const tempActualId = weatherCfg.metrics.temp?.actualStateId ?? "";
	const liveOutdoorC = tempActualId ? await readForeignNum(host, tempActualId) : null;

	const rawByDay = new Map<number, { min: number | null; max: number | null; mapped: boolean }>();
	for (const dayCfg of cfg.days) {
		const mapped = Boolean(dayCfg.minTempStateId || dayCfg.maxTempStateId);
		const min = dayCfg.minTempStateId ? await readForeignNum(host, dayCfg.minTempStateId) : null;
		const max = dayCfg.maxTempStateId ? await readForeignNum(host, dayCfg.maxTempStateId) : null;
		rawByDay.set(dayCfg.dayIndex, { min, max, mapped });
	}

	const day1 = rawByDay.get(1) ?? { min: null, max: null, mapped: false };
	const todayKey = localDateKey();
	const { minBiasC, maxBiasC } = await resolveAndUpdateBias(
		host,
		todayKey,
		day1.min,
		day1.max,
		liveOutdoorC,
	);

	let available = 0;
	for (const day of WEATHER_HORIZON_DAY_INDEXES) {
		const raw = rawByDay.get(day) ?? { min: null, max: null, mapped: false };
		const corrMin = correctHorizonTempC(raw.min, minBiasC, day);
		const corrMax = correctHorizonTempC(raw.max, maxBiasC, day);
		const quality = dayQuality(corrMin, corrMax, raw.mapped);
		if (quality === "valid" || quality === "degraded") {
			available += 1;
		}
		const prefix = weatherHorizonDayStatePrefix(day);
		await setNumOrClear(host, `${prefix}.raw_min_temp_c`, raw.min);
		await setNumOrClear(host, `${prefix}.raw_max_temp_c`, raw.max);
		await setNumOrClear(host, `${prefix}.min_temp_c`, corrMin);
		await setNumOrClear(host, `${prefix}.max_temp_c`, corrMax);
		await host.setStateAsync(`${prefix}.quality`, { val: quality, ack: true });
	}

	const status = available > 0 ? (minBiasC !== null || maxBiasC !== null ? "ready" : "no_bias") : "no_data";
	await host.setStateAsync("learning.weather.horizon.status", { val: status, ack: true });
	await host.setStateAsync("learning.weather.horizon.days_available", { val: available, ack: true });
	await host.setStateAsync("learning.weather.horizon.last_update", {
		val: new Date().toISOString(),
		ack: true,
	});
	host.log.debug?.(
		`Weather-Horizon: ${available}/${WEATHER_HORIZON_DAY_INDEXES.length} days (bias min=${minBiasC ?? "n/a"} max=${maxBiasC ?? "n/a"})`,
	);
}
