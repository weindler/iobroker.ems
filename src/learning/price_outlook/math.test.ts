import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDaySlotLayout } from "../day_telemetry/slots";
import { buildLocalPvRawKwh, buildPriceOutlook, learnTibberSpread } from "./math";
import { mergeSpreadPairs } from "./run";
import type { RegionalWeather, SmardPoint } from "./types";

function smardHistory(nowMs: number): SmardPoint[] {
	const points: SmardPoint[] = [];
	for (let day = 1; day <= 120; day++) {
		for (let hour = 0; hour < 24; hour++) {
			for (let quarter = 0; quarter < 4; quarter++) {
				points.push({ ts: nowMs - day * 86_400_000 + hour * 3_600_000 + quarter * 900_000, ctPerKwh: 8 + hour * 0.2 });
			}
		}
	}
	return points;
}

function weatherForLayout(dateKeys: string[], timezone: string): RegionalWeather[] {
	return ["Nord", "West", "Mitte", "Ost", "Süd"].map((region) => ({
		region,
		points: dateKeys.flatMap((key) => buildDaySlotLayout(key, timezone).slots
			.filter((_, index) => index % 4 === 0)
			.map((slot) => ({ ts: slot.startMs, temperatureC: 15, windKmh: 20, solarKwhM2: 0.25, cloudPct: 30 }))),
	}));
}

describe("Greenshare-artige Sieben-Tage-Preisprognose", () => {
	it("lernt den Tibber-Endpreis-Spread aus zeitlich überlappenden Viertelstunden", () => {
		const smard = [0, 1, 2, 3].map((index) => ({ ts: index * 900_000, ctPerKwh: 10 + index }));
		const tibber = smard.map((point) => ({ slotStartMs: point.ts, priceCtPerKwh: point.ctPerKwh + 20 }));
		const spread = learnTibberSpread(smard, tibber);
		assert.equal(spread.expectedCtPerKwh, 20);
		assert.equal(spread.sampleCount, 4);
	});

	it("behält gelernte Vergleichspaare, ergänzt neue und entfernt veraltete", () => {
		const nowMs = Date.parse("2026-09-19T12:00:00.000Z");
		const recentTs = nowMs - 86_400_000;
		const newTs = nowMs;
		const pairs = mergeSpreadPairs(
			[
				{ ts: nowMs - 181 * 86_400_000, tibberCtPerKwh: 30, smardCtPerKwh: 10 },
				{ ts: recentTs, tibberCtPerKwh: 31, smardCtPerKwh: 11 },
			],
			[{ ts: newTs, ctPerKwh: 12 }],
			[{ slotStartMs: newTs, priceCtPerKwh: 33 }],
			nowMs,
		);
		assert.deepEqual(pairs, [
			{ ts: recentTs, tibberCtPerKwh: 31, smardCtPerKwh: 11 },
			{ ts: newTs, tibberCtPerKwh: 33, smardCtPerKwh: 12 },
		]);
	});

	it("behält Tibber als echte 15-Minuten-Werte und schätzt danach nur stündlich", () => {
		const timezone = "Europe/Berlin";
		const now = new Date("2026-09-19T08:00:00.000Z");
		const today = "2026-09-19";
		const dateKeys = Array.from({ length: 7 }, (_, index) => {
			const date = new Date(Date.UTC(2026, 8, 19 + index));
			return date.toISOString().slice(0, 10);
		});
		const smard = smardHistory(now.getTime());
		const firstSlots = buildDaySlotLayout(today, timezone).slots.filter((slot) => slot.startMs >= now.getTime()).slice(0, 4);
		const tibber = firstSlots.map((slot, index) => ({ slotStartMs: slot.startMs, priceCtPerKwh: 30 + index }));
		const outlook = buildPriceOutlook({ now, timezone, tibber, smard, weather: weatherForLayout(dateKeys, timezone), smardAvailable: true, weatherAvailable: true });
		const published = outlook.days[0].hours.filter((hour) => hour.kind === "published");
		const estimated = outlook.days.flatMap((day) => day.hours).filter((hour) => hour.kind === "estimated");
		assert.equal(published.length, 4);
		assert.ok(published.every((hour) => hour.resolutionMinutes === 15));
		assert.ok(estimated.length > 0);
		assert.ok(estimated.every((hour) => hour.resolutionMinutes === 60));
		assert.equal(outlook.informationalOnly, true);
	});

	it("zeigt bei fehlender wesentlicher Quelle keine erfundene Zahl", () => {
		const outlook = buildPriceOutlook({ now: new Date("2026-09-19T08:00:00.000Z"), timezone: "Europe/Berlin", tibber: [], smard: [], weather: [], smardAvailable: false, weatherAvailable: false });
		assert.equal(outlook.status, "unavailable");
		assert.ok(outlook.days.every((day) => day.avgCtPerKwh === null));
	});

	it("erzeugt lokale PV-Rohenergie aus Bright-Sky-Globalstrahlung und kWp", () => {
		const weather: RegionalWeather[] = [{
			region: "Anlagenstandort",
			points: [
				{ ts: Date.parse("2026-09-19T10:00:00.000Z"), temperatureC: 20, windKmh: 5, solarKwhM2: 0.5, cloudPct: 10 },
				{ ts: Date.parse("2026-09-19T11:00:00.000Z"), temperatureC: 21, windKmh: 5, solarKwhM2: 0.5, cloudPct: 10 },
			],
		}];
		const result = buildLocalPvRawKwh({ weather, pvKwp: 10, timezone: "Europe/Berlin", now: new Date("2026-09-19T08:00:00.000Z") });
		assert.equal(result[0], 8.2);
	});

	it("bildet DST-Tage ohne erfundene 15-Minuten-Schätzungen ab", () => {
		const timezone = "Europe/Berlin";
		assert.equal(buildDaySlotLayout("2026-03-29", timezone).slotCount, 92);
		assert.equal(buildDaySlotLayout("2026-03-30", timezone).slotCount, 96);
		const now = new Date("2026-10-24T22:00:00.000Z");
		const layout = buildDaySlotLayout("2026-10-25", timezone);
		assert.equal(layout.slotCount, 100);
		const outlook = buildPriceOutlook({ now, timezone, tibber: [], smard: smardHistory(now.getTime()), weather: weatherForLayout(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"], timezone), smardAvailable: true, weatherAvailable: true });
		assert.ok(outlook.days[0].hours.every((hour) => hour.resolutionMinutes === 60));
	});
});
