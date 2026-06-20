import type { FrozenHourSlot } from "./types";

type TibberSlotRaw = {
	total?: unknown;
	startsAt?: unknown;
	starts_at?: unknown;
};

function asNum(v: unknown): number | null {
	if (v === null || v === undefined || v === "") return null;
	const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
	return Number.isFinite(n) ? n : null;
}

function parseStartsAtMs(raw: unknown): number | null {
	if (typeof raw !== "string" || !raw.trim()) return null;
	const ms = Date.parse(raw);
	return Number.isFinite(ms) ? ms : null;
}

function hourStartMs(ts: number): number {
	return Math.floor(ts / 3_600_000) * 3_600_000;
}

function dateKeyFromMs(ts: number): string {
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function tomorrowDateKey(ref: Date): string {
	const d = new Date(ref);
	d.setHours(12, 0, 0, 0);
	d.setDate(d.getDate() + 1);
	return dateKeyFromMs(d.getTime());
}

/** Parse Tibber PricesToday/Tomorrow JSON → stündliche Forecast-Slots in ct/kWh. */
export function parseTibberPriceJsonToHourlySlots(
	raw: unknown,
	targetDateKey: string,
): FrozenHourSlot[] {
	let parsed: unknown = raw;
	if (typeof raw === "string") {
		try {
			parsed = JSON.parse(raw);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) {
		return [];
	}

	const byHour = new Map<number, number[]>();
	for (const entry of parsed) {
		if (!entry || typeof entry !== "object") continue;
		const row = entry as TibberSlotRaw;
		const totalEur = asNum(row.total);
		const startsMs = parseStartsAtMs(row.startsAt ?? row.starts_at);
		if (totalEur === null || startsMs === null || totalEur < 0 || totalEur > 5) {
			continue;
		}
		if (dateKeyFromMs(startsMs) !== targetDateKey) {
			continue;
		}
		const bucket = hourStartMs(startsMs);
		const list = byHour.get(bucket) ?? [];
		list.push(totalEur * 100);
		byHour.set(bucket, list);
	}

	const slots: FrozenHourSlot[] = [];
	for (const [hourStart, values] of byHour.entries()) {
		if (values.length === 0) continue;
		const avgCt = values.reduce((a, b) => a + b, 0) / values.length;
		slots.push({ hourStartMs: hourStart, forecastCtPerKwh: Math.round(avgCt * 1000) / 1000 });
	}
	return slots.sort((a, b) => a.hourStartMs - b.hourStartMs);
}

export function targetDateForTomorrowFreeze(ref: Date): string {
	return tomorrowDateKey(ref);
}

export { dateKeyFromMs };
