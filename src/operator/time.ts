import { MS_PER_15MIN } from "../learning/price_forecast/tibber_parse";

export const OPERATOR_MS_PER_15MIN = MS_PER_15MIN;

export function isoFromMs(ms: number): string {
	return new Date(ms).toISOString();
}

export function slotEndMsFromStart(startMs: number): number {
	return startMs + OPERATOR_MS_PER_15MIN;
}

export function isValidIsoTimestamp(iso: string): boolean {
	if (!iso.trim()) return false;
	const ms = Date.parse(iso);
	return Number.isFinite(ms);
}

interface ZonedParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
}

function zonedParts(ms: number, timezone: string): ZonedParts {
	const fmt = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hour12: false,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
	const parts = fmt.formatToParts(new Date(ms));
	const pick = (type: Intl.DateTimeFormatPartTypes): number => {
		const v = parts.find((p) => p.type === type)?.value ?? "0";
		return parseInt(v, 10);
	};
	return {
		year: pick("year"),
		month: pick("month"),
		day: pick("day"),
		hour: pick("hour"),
		minute: pick("minute"),
	};
}

export function localDateKeyInTimezone(d: Date, timezone: string): string {
	const p = zonedParts(d.getTime(), timezone);
	return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function isoAtTimezoneLocal(
	dateKey: string,
	hour: number,
	minute: number,
	timezone: string,
): string {
	const [y, mo, da] = dateKey.split("-").map((x) => parseInt(x, 10));
	let lo = Date.UTC(y, mo - 1, da, 0, 0, 0) - 36 * MS_PER_15MIN;
	let hi = Date.UTC(y, mo - 1, da, 23, 59, 59) + 36 * MS_PER_15MIN;
	for (let ms = lo; ms <= hi; ms += 60_000) {
		const p = zonedParts(ms, timezone);
		if (p.year === y && p.month === mo && p.day === da && p.hour === hour && p.minute === minute) {
			return isoFromMs(ms);
		}
	}
	return isoFromMs(Date.UTC(y, mo - 1, da, hour, minute, 0));
}

export function addDaysToDateKey(dateKey: string, days: number): string {
	const [y, mo, da] = dateKey.split("-").map((x) => parseInt(x, 10));
	const d = new Date(Date.UTC(y, mo - 1, da + days, 12, 0, 0));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
