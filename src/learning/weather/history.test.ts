import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayBoundsMs, evaluateWeatherDay, type WeatherHistoryHost } from "./history";
import type { WeatherMetricKey } from "./constants";
import type { WeatherMetricMapping } from "./types";

const HOUR = 3_600_000;

type Row = { ts: number; val: number };

function makeHost(byId: Record<string, Row[]>): WeatherHistoryHost {
	return {
		getHistoryAsync: async (id: string) => ({
			result: (byId[id] ?? []) as unknown as ioBroker.GetHistoryResult,
		}),
	};
}

/** Zeilen über mehrere Stunden eines Tages (dayOffset). */
function hourlyRows(dayOffset: number, hours: number[], value: number): Row[] {
	const { start } = dayBoundsMs(dayOffset);
	return hours.map((h) => ({ ts: start + h * HOUR + 60_000, val: value }));
}

describe("weather evaluateWeatherDay", () => {
	it("berechnet jede Metrik über ihre EIGENEN Stunden (Regen unabhängig von Temp)", async () => {
		const metrics: Partial<Record<WeatherMetricKey, WeatherMetricMapping>> = {
			temp: { forecastStateId: "brightsky.0.temp", actualStateId: "0_userdata.0.temp" },
			rain: { forecastStateId: "brightsky.0.rain", actualStateId: "0_userdata.0.rain" },
		};

		// Temp deckt viele Stunden ab; Regen nur 3 ANDERE Stunden — früher fiel Regen weg.
		const host = makeHost({
			"brightsky.0.temp": hourlyRows(1, [0, 1, 2, 3, 4, 5, 6, 7], 10),
			"0_userdata.0.temp": hourlyRows(1, [0, 1, 2, 3, 4, 5, 6, 7], 12),
			"brightsky.0.rain": hourlyRows(1, [20, 21, 22], 1),
			"0_userdata.0.rain": hourlyRows(1, [20, 21, 22], 2.5),
		});

		const day = await evaluateWeatherDay(host, metrics, 1);

		assert.equal(day.metrics.temp?.validHours, 8);
		assert.equal(day.metrics.temp?.bias, 2); // 12 - 10
		assert.equal(day.metrics.rain?.validHours, 3);
		assert.equal(day.metrics.rain?.bias, 1.5); // 2.5 - 1
		assert.equal(day.validHours, 8); // bestabgedeckte Metrik
	});

	it("liefert Regen-Bias=null mit missingActual, wenn die Ist-Seite keine History hat", async () => {
		const metrics: Partial<Record<WeatherMetricKey, WeatherMetricMapping>> = {
			temp: { forecastStateId: "brightsky.0.temp", actualStateId: "0_userdata.0.temp" },
			rain: { forecastStateId: "brightsky.0.rain", actualStateId: "0_userdata.0.rain" },
		};

		const host = makeHost({
			"brightsky.0.temp": hourlyRows(1, [0, 1, 2, 3, 4, 5], 10),
			"0_userdata.0.temp": hourlyRows(1, [0, 1, 2, 3, 4, 5], 11),
			"brightsky.0.rain": hourlyRows(1, [10, 11, 12], 1),
			// rain Ist fehlt komplett
		});

		const day = await evaluateWeatherDay(host, metrics, 1);

		assert.equal(day.metrics.temp?.bias, 1);
		assert.equal(day.metrics.rain?.bias, null);
		assert.equal(day.metrics.rain?.validHours, 0);
		assert.ok(day.missingActual.includes("rain"));
		assert.ok(!day.missingActual.includes("temp"));
	});
});
