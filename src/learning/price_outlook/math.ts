import { addDaysToDateKey, localDateKeyInTimezone } from "../../operator/time";
import { buildDaySlotLayout } from "../day_telemetry/slots";
import type { Price15MinSlot } from "../price_forecast/tibber_parse";
import type {
	PriceOutlook,
	PriceOutlookDay,
	PriceOutlookHour,
	RegionalWeather,
	SmardPoint,
	TibberSmardPair,
} from "./types";

const round = (value: number, digits = 2): number => {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
};

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function learnTibberSpread(smard: SmardPoint[], tibber: Price15MinSlot[]): PriceOutlook["spread"] {
	const byTs = new Map(smard.map((point) => [point.ts, point.ctPerKwh]));
	return learnTibberSpreadFromDifferences(tibber.flatMap((slot) => {
		const market = byTs.get(slot.slotStartMs);
		return market === undefined ? [] : [slot.priceCtPerKwh - market];
	}));
}

export function learnTibberSpreadFromPairs(pairs: TibberSmardPair[]): PriceOutlook["spread"] {
	return learnTibberSpreadFromDifferences(pairs.map((pair) => pair.tibberCtPerKwh - pair.smardCtPerKwh));
}

function learnTibberSpreadFromDifferences(differences: number[]): PriceOutlook["spread"] {
	const expected = median(differences);
	const mad = expected === null ? null : median(differences.map((value) => Math.abs(value - expected)));
	const sampleFactor = Math.min(1, differences.length / 48);
	const stabilityFactor = mad === null ? 0 : Math.max(0, 1 - mad / 15);
	return {
		expectedCtPerKwh: expected === null ? null : round(expected, 3),
		madCtPerKwh: mad === null ? null : round(mad, 3),
		sampleCount: differences.length,
		confidencePct: Math.round(sampleFactor * stabilityFactor * 100),
	};
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();
const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedHour(ms: number, timezone: string): number {
	let formatter = hourFormatters.get(timezone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" });
		hourFormatters.set(timezone, formatter);
	}
	const parts = formatter.formatToParts(new Date(ms));
	return Number(parts.find((part) => part.type === "hour")?.value ?? 0);
}

function isWeekend(ms: number, timezone: string): boolean {
	let formatter = weekdayFormatters.get(timezone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, weekday: "short" });
		weekdayFormatters.set(timezone, formatter);
	}
	const weekday = formatter.format(new Date(ms));
	return weekday.startsWith("Sa") || weekday.startsWith("So");
}

function buildHistoricalPatterns(smard: SmardPoint[], targetMs: number, timezone: string): Map<string, { value: number | null; samples: number }> {
	const recentCutoff = targetMs - 90 * 86_400_000;
	const groups = new Map<string, Array<{ value: number; weight: number }>>();
	for (const point of smard) {
		const key = `${isWeekend(point.ts, timezone) ? 1 : 0}:${zonedHour(point.ts, timezone)}`;
		const values = groups.get(key) ?? [];
		values.push({ value: point.ctPerKwh, weight: point.ts >= recentCutoff ? 2 : 1 });
		groups.set(key, values);
	}
	const patterns = new Map<string, { value: number | null; samples: number }>();
	for (const [key, values] of groups) {
		const center = median(values.map((entry) => entry.value));
		if (center === null) { patterns.set(key, { value: null, samples: 0 }); continue; }
		const mad = median(values.map((entry) => Math.abs(entry.value - center))) ?? 0;
		const limit = Math.max(2, mad * 2.5);
		let sum = 0;
		let weights = 0;
		for (const entry of values) {
			const distance = Math.abs(entry.value - center);
			const robustWeight = distance > limit ? limit / distance : 1;
			const weight = entry.weight * robustWeight;
			sum += entry.value * weight;
			weights += weight;
		}
		patterns.set(key, { value: weights > 0 ? sum / weights : null, samples: values.length });
	}
	return patterns;
}

function regionalWeatherAt(regions: RegionalWeather[], targetMs: number) {
	const values = regions.flatMap((region) => {
		const point = region.points.reduce<{ distance: number; point: RegionalWeather["points"][number] } | null>((best, candidate) => {
			const distance = Math.abs(candidate.ts - targetMs);
			return !best || distance < best.distance ? { distance, point: candidate } : best;
		}, null);
		return point && point.distance <= 90 * 60_000 ? [point.point] : [];
	});
	const avg = (items: Array<number | null>): number | null => {
		const finite = items.filter((item): item is number => item !== null && Number.isFinite(item));
		return finite.length ? finite.reduce((sum, item) => sum + item, 0) / finite.length : null;
	};
	return {
		coverage: values.length / Math.max(1, regions.length),
		windKmh: avg(values.map((point) => point.windKmh)),
		solarKwhM2: avg(values.map((point) => point.solarKwhM2)),
		temperatureC: avg(values.map((point) => point.temperatureC)),
	};
}

function labelForDay(offset: number, dateKey: string, timezone: string): string {
	if (offset === 0) return "Heute";
	if (offset === 1) return "Morgen";
	if (offset === 2) return "Übermorgen";
	const start = buildDaySlotLayout(dateKey, timezone).startMs;
	const weekday = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, weekday: "long" }).format(new Date(start));
	const [year, month, day] = dateKey.split("-");
	return `${weekday} (${day}.${month}.)`;
}

function tendency(value: number | null, center: number | null): PriceOutlookDay["tendency"] {
	if (value === null || center === null) return "unknown";
	if (value < center - 3) return "guenstig";
	if (value > center + 3) return "teuer";
	return "normal";
}

export function buildPriceOutlook(args: {
	now: Date;
	timezone: string;
	tibber: Price15MinSlot[];
	smard: SmardPoint[];
	weather: RegionalWeather[];
	smardAvailable: boolean;
	weatherAvailable: boolean;
	spreadPairs?: TibberSmardPair[];
}): PriceOutlook {
	const nowMs = args.now.getTime();
	const today = localDateKeyInTimezone(args.now, args.timezone);
	const spread = args.spreadPairs
		? learnTibberSpreadFromPairs(args.spreadPairs)
		: learnTibberSpread(args.smard, args.tibber);
	const historicalPatterns = buildHistoricalPatterns(args.smard, nowMs, args.timezone);
	const tibberByTs = new Map(args.tibber.map((slot) => [slot.slotStartMs, slot.priceCtPerKwh]));
	const globalCenter = median(args.smard.filter((point) => point.ts >= nowMs - 90 * 86_400_000).map((point) => point.ctPerKwh));
	const days: PriceOutlookDay[] = [];

	for (let offset = 0; offset < 7; offset++) {
		const dateKey = addDaysToDateKey(today, offset);
		const layout = buildDaySlotLayout(dateKey, args.timezone);
		const futureSlots = layout.slots.filter((slot) => slot.startMs >= nowMs);
		const hours: PriceOutlookHour[] = [];
		for (const slot of futureSlots) {
			const published = tibberByTs.get(slot.startMs);
			if (published !== undefined) {
				hours.push({
					startIso: new Date(slot.startMs).toISOString(),
					resolutionMinutes: 15,
					kind: "published",
					source: "tibber",
					expectedCtPerKwh: round(published, 3),
					minCtPerKwh: round(published, 3),
					maxCtPerKwh: round(published, 3),
					confidencePct: null,
				});
				continue;
			}
			if (slot.startMs % 3_600_000 !== 0) continue;
			if (!args.smardAvailable || !args.weatherAvailable) {
				hours.push({ startIso: new Date(slot.startMs).toISOString(), resolutionMinutes: 60, kind: "unavailable", source: "none", expectedCtPerKwh: null, minCtPerKwh: null, maxCtPerKwh: null, confidencePct: 0 });
				continue;
			}
			const historical = historicalPatterns.get(`${isWeekend(slot.startMs, args.timezone) ? 1 : 0}:${zonedHour(slot.startMs, args.timezone)}`) ?? { value: null, samples: 0 };
			const weather = regionalWeatherAt(args.weather, slot.startMs);
			if (historical.value === null || weather.coverage < 0.6) {
				hours.push({ startIso: new Date(slot.startMs).toISOString(), resolutionMinutes: 60, kind: "unavailable", source: "none", expectedCtPerKwh: null, minCtPerKwh: null, maxCtPerKwh: null, confidencePct: 0 });
				continue;
			}
			const renewableAdjustment = -Math.min(12, (weather.windKmh ?? 0) * 0.12 + (weather.solarKwhM2 ?? 0) * 5);
			const temperatureAdjustment = weather.temperatureC === null ? 0 : Math.max(-3, Math.min(5, (12 - weather.temperatureC) * 0.18));
			const marketEstimate = historical.value + renewableAdjustment + temperatureAdjustment;
			const spreadReady = spread.sampleCount >= 12 && spread.expectedCtPerKwh !== null;
			const expected = marketEstimate + (spread.expectedCtPerKwh ?? 0);
			const horizonFactor = Math.max(0.45, 1 - offset * 0.08);
			const historyFactor = Math.min(1, historical.samples / 100);
			const confidence = Math.round(100 * weather.coverage * historyFactor * horizonFactor * (spreadReady ? Math.max(0.5, spread.confidencePct / 100) : 0.35));
			const uncertainty = Math.max(6, (spread.madCtPerKwh ?? 8) * 2) * (1 + offset * 0.12);
			hours.push({
				startIso: new Date(slot.startMs).toISOString(),
				resolutionMinutes: 60,
				kind: "estimated",
				source: "smard_brightsky",
				expectedCtPerKwh: round(expected, 2),
				minCtPerKwh: round(expected - uncertainty, 2),
				maxCtPerKwh: round(expected + uncertainty, 2),
				confidencePct: confidence,
			});
		}

		const publishedCount = hours.filter((hour) => hour.kind === "published").length;
		const estimated = hours.filter((hour) => hour.kind === "estimated");
		const numerical = hours.filter((hour) => hour.kind === "published" || (hour.kind === "estimated" && (hour.confidencePct ?? 0) >= 50));
		const confidence = estimated.length ? Math.round(estimated.reduce((sum, hour) => sum + (hour.confidencePct ?? 0), 0) / estimated.length) : null;
		const status: PriceOutlookDay["status"] = publishedCount === hours.length && hours.length > 0
			? "fully_published"
			: publishedCount > 0
				? "partly_published"
				: estimated.length > 0
					? "estimated"
					: "unavailable";
		const expectedValues = numerical.flatMap((hour) => hour.expectedCtPerKwh === null ? [] : [hour.expectedCtPerKwh]);
		const minValues = numerical.flatMap((hour) => hour.minCtPerKwh === null ? [] : [hour.minCtPerKwh]);
		const maxValues = numerical.flatMap((hour) => hour.maxCtPerKwh === null ? [] : [hour.maxCtPerKwh]);
		const avg = expectedValues.length ? expectedValues.reduce((sum, value) => sum + value, 0) / expectedValues.length : null;
		const statusDe = status === "fully_published" ? "vollständig veröffentlicht" : status === "partly_published" ? "teilweise veröffentlicht" : status === "estimated" ? "geschätzte Tendenz" : "noch keine belastbare Preisprognose";
		days.push({
			dateKey,
			dayOffset: offset,
			labelDe: labelForDay(offset, dateKey, args.timezone),
			status,
			statusDe,
			confidencePct: confidence,
			minCtPerKwh: minValues.length ? round(Math.min(...minValues), 2) : null,
			avgCtPerKwh: avg === null ? null : round(avg, 2),
			maxCtPerKwh: maxValues.length ? round(Math.max(...maxValues), 2) : null,
			tendency: tendency(avg, globalCenter === null ? null : globalCenter + (spread.expectedCtPerKwh ?? 0)),
			reasonDe: status === "estimated"
				? spread.sampleCount > 0
					? `SMARD-Preismuster, Wetterlage und gelernter Tibber-Aufschlag aus ${spread.sampleCount} Vergleichswerten; rein informativ.`
					: "SMARD-Preismuster sowie Wind-, Solar- und Temperaturlage; ein persönlicher Tibber-Aufschlag konnte noch nicht gelernt werden."
				: status === "unavailable"
					? "SMARD- oder Bright-Sky-Daten fehlen; es wird keine Zahl erfunden."
					: "Veröffentlichte Tibber-Endpreise haben Vorrang vor jeder Schätzung.",
			hours,
		});
	}

	const hasEstimated = days.some((day) => day.status === "estimated" || day.status === "partly_published");
	const hasAny = days.some((day) => day.status !== "unavailable");
	return {
		schemaVersion: 1,
		generatedAtIso: args.now.toISOString(),
		timezone: args.timezone,
		status: hasAny ? (hasEstimated && (!args.smardAvailable || !args.weatherAvailable) ? "degraded" : "ready") : "unavailable",
		statusDe: hasAny ? "Sieben-Tage-Preisvorschau aktualisiert" : "Noch keine belastbare Preisprognose",
		informationalOnly: true,
		sources: {
			tibber: args.tibber.length ? "available" : "missing",
			smard: args.smardAvailable ? "available" : "missing",
			brightSky: args.weatherAvailable ? "available" : "missing",
		},
		spread,
		days,
	};
}

export function buildLocalPvRawKwh(args: {
	weather: RegionalWeather[];
	pvKwp: number;
	timezone: string;
	now: Date;
}): Array<number | null> {
	const today = localDateKeyInTimezone(args.now, args.timezone);
	const points = args.weather.flatMap((region) => region.points);
	return Array.from({ length: 7 }, (_, offset) => {
		const dateKey = addDaysToDateKey(today, offset);
		const solarKwhM2 = points
			.filter((point) => localDateKeyInTimezone(new Date(point.ts), args.timezone) === dateKey)
			.reduce((sum, point) => sum + Math.max(0, point.solarKwhM2 ?? 0), 0);
		if (solarKwhM2 <= 0) return null;
		// Bright-Sky `solar` ist die Globalstrahlung der vorherigen Stunde in kWh/m². PR 0,82 ist
		// nur die Rohmodell-Umrechnung; der standortspezifische Fehler wird danach vom
		// freigegebenen 90/14-Tage-PV-Bias gelernt, nicht hier versteckt korrigiert.
		return round(solarKwhM2 * args.pvKwp * 0.82, 3);
	});
}
