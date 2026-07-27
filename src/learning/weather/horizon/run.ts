import { weatherHorizonConfigFromAdapter, weatherHorizonHasAnyMapping } from "./config";
import { WEATHER_HORIZON_DAY_INDEXES } from "./constants";
import { weatherHorizonDayStatePrefix } from "./ensure_states";
import type { WeatherHorizonDayQuality } from "./config";

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

async function readForeignNum(host: WeatherHorizonRunHost, id: string): Promise<number | null> {
	if (!id) return null;
	try {
		const reader = host.getForeignStateAsync ?? host.getStateAsync;
		const st = await reader(id);
		const n = typeof st?.val === "number" ? st.val : Number(st?.val);
		return Number.isFinite(n) ? n : null;
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

/**
 * Copy Admin-mapped foreign daily min/max temps into learning.weather.horizon.day{3-7}.*
 * Unmapped or unreadable → null / quality missing — never invent 0.
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
			await setNumOrClear(host, `${prefix}.min_temp_c`, null);
			await setNumOrClear(host, `${prefix}.max_temp_c`, null);
			await host.setStateAsync(`${prefix}.quality`, { val: "missing", ack: true });
		}
		return;
	}

	let available = 0;
	for (const dayCfg of cfg.days) {
		const mapped = Boolean(dayCfg.minTempStateId || dayCfg.maxTempStateId);
		const min = dayCfg.minTempStateId ? await readForeignNum(host, dayCfg.minTempStateId) : null;
		const max = dayCfg.maxTempStateId ? await readForeignNum(host, dayCfg.maxTempStateId) : null;
		const quality = dayQuality(min, max, mapped);
		if (quality === "valid" || quality === "degraded") {
			available += 1;
		}
		const prefix = weatherHorizonDayStatePrefix(dayCfg.dayIndex);
		await setNumOrClear(host, `${prefix}.min_temp_c`, min);
		await setNumOrClear(host, `${prefix}.max_temp_c`, max);
		await host.setStateAsync(`${prefix}.quality`, { val: quality, ack: true });
	}

	const status = available > 0 ? "ready" : "no_data";
	await host.setStateAsync("learning.weather.horizon.status", { val: status, ack: true });
	await host.setStateAsync("learning.weather.horizon.days_available", { val: available, ack: true });
	await host.setStateAsync("learning.weather.horizon.last_update", {
		val: new Date().toISOString(),
		ack: true,
	});
	host.log.debug?.(`Weather-Horizon: ${available}/${WEATHER_HORIZON_DAY_INDEXES.length} days available`);
}
