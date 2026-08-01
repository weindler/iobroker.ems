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

const FORMATTER_OPTIONS: Intl.DateTimeFormatOptions = {
	timeZone: "UTC",
	hour12: false,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
};

/** Cache formatters — creating one per minute-scan blew RSS by hundreds of MiB. */
const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

function createFormatter(timezone: string): Intl.DateTimeFormat {
	return new Intl.DateTimeFormat("en-US", { ...FORMATTER_OPTIONS, timeZone: timezone });
}

/**
 * Resolve a cached formatter for a timezone.
 * Invalid zones are not cached; callers fall back to UTC for conversion.
 */
function zonedFormatter(timezone: string): Intl.DateTimeFormat {
	const key = timezone.trim() || "UTC";
	const cached = zonedFormatters.get(key);
	if (cached) return cached;
	try {
		const fmt = createFormatter(key);
		// Validate eagerly so bad zones never enter the cache.
		fmt.formatToParts(new Date());
		zonedFormatters.set(key, fmt);
		return fmt;
	} catch {
		if (key === "UTC") {
			return createFormatter("UTC");
		}
		return zonedFormatter("UTC");
	}
}

function zonedParts(ms: number, timezone: string): ZonedParts {
	const parts = zonedFormatter(timezone).formatToParts(new Date(ms));
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

/**
 * ISO/UTC → deutsche Ortszeit-Anzeige (TT.MM.JJJJ, HH:MM) in `timezone`.
 * Für Briefing/KI — nie die UTC-Ziffern aus `…Z` als lokale Uhrzeit vorlesen.
 */
export function formatLocalDateTimeDe(isoOrMs: string | number, timezone: string): string | null {
	const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
	if (!Number.isFinite(ms)) return null;
	const p = zonedParts(ms, timezone.trim() || "Europe/Berlin");
	return (
		`${String(p.day).padStart(2, "0")}.${String(p.month).padStart(2, "0")}.${p.year}, ` +
		`${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`
	);
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

export function zonedFormatterCacheSizeForTest(): number {
	return zonedFormatters.size;
}

export function resetZonedFormatterCacheForTest(): void {
	zonedFormatters.clear();
}

export function zonedFormatterCacheHasForTest(timezone: string): boolean {
	return zonedFormatters.has(timezone);
}
