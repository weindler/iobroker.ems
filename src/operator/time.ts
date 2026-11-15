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

/** Versatz (ms) der Zeitzone gegenüber UTC zum Zeitpunkt `ms`, auf volle Minuten. */
function zoneOffsetMs(ms: number, timezone: string): number {
	const p = zonedParts(ms, timezone);
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0) - Math.floor(ms / 60_000) * 60_000;
}

const isoLocalMemo = new Map<string, string>();
const ISO_LOCAL_MEMO_MAX = 4000;

/**
 * Ortszeit (Datum, Stunde, Minute) → ISO/UTC. Früheste passende Zeit; gibt es die Ortszeit nicht
 * (Zeitumstellung), wird die Zeit als UTC gelesen. Direkte Berechnung über die Zeitzonen-Versätze
 * des Tages statt Minutensuche (die Suche erzeugte pro Aufruf tausende Objekte).
 */
export function isoAtTimezoneLocal(
	dateKey: string,
	hour: number,
	minute: number,
	timezone: string,
): string {
	const memoKey = `${timezone}|${dateKey}|${hour}|${minute}`;
	const hit = isoLocalMemo.get(memoKey);
	if (hit !== undefined) return hit;
	const [y, mo, da] = dateKey.split("-").map((x) => parseInt(x, 10));
	const wall = Date.UTC(y, mo - 1, da, hour, minute, 0);
	const offsets = new Set<number>([zoneOffsetMs(wall - 24 * 3_600_000, timezone), zoneOffsetMs(wall + 24 * 3_600_000, timezone)]);
	let best: number | null = null;
	for (const off of offsets) {
		const ms = wall - off;
		const p = zonedParts(ms, timezone);
		if (p.year === y && p.month === mo && p.day === da && p.hour === hour && p.minute === minute) {
			if (best === null || ms < best) best = ms;
		}
	}
	const out = isoFromMs(best ?? wall);
	if (isoLocalMemo.size >= ISO_LOCAL_MEMO_MAX) isoLocalMemo.clear();
	isoLocalMemo.set(memoKey, out);
	return out;
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
	isoLocalMemo.clear();
}

export function zonedFormatterCacheHasForTest(timezone: string): boolean {
	return zonedFormatters.has(timezone);
}
