import { isoAtTimezoneLocal, isoFromMs, localDateKeyInTimezone, addDaysToDateKey } from "../../../../operator/time";
import type { EvSmartPlanSlot } from "./types";

const START_KEYS = [
	"start",
	"startat",
	"startsat",
	"from",
	"begin",
	"starttime",
	"start_time",
	"fromtime",
	"beginat",
];
const END_KEYS = ["end", "endat", "endsat", "to", "until", "stop", "endtime", "end_time", "totime", "finish"];
const ENERGY_KWH_KEYS = ["plannedenergykwh", "energykwh", "energy_kwh", "kwh", "energy"];
const POWER_KW_KEYS = ["plannedpowerkw", "powerkw", "power_kw", "kw"];
const POWER_W_KEYS = ["plannedpowerw", "powerw", "power_w", "chargepowerw", "chargepower"];
const SOURCE_KEYS = ["source", "origin", "provider"];
const NESTED_ARRAY_KEYS = [
	"slots",
	"schedule",
	"schedules",
	"windows",
	"charges",
	"items",
	"data",
	"plan",
	"value",
	"values",
	"periods",
	"intervals",
];

export interface ParseSmartPlanResult {
	slots: EvSmartPlanSlot[];
	ignoredCount: number;
	parseable: boolean;
	error: string | null;
}

function lowerKeyMap(obj: Record<string, unknown>): Map<string, unknown> {
	const m = new Map<string, unknown>();
	for (const [k, v] of Object.entries(obj)) {
		m.set(k.toLowerCase().replace(/[\s-]/g, ""), v);
	}
	return m;
}

function pickKey(map: Map<string, unknown>, keys: string[]): unknown {
	for (const k of keys) {
		if (map.has(k)) return map.get(k);
	}
	return undefined;
}

function unwrapDateTime(raw: unknown): unknown {
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		const o = raw as Record<string, unknown>;
		if (o.dateTime != null) return o.dateTime;
		if (o.datetime != null) return o.datetime;
		if (o.date != null && o.time == null) return o.date;
	}
	return raw;
}

/** Unix seconds, unix ms, or parseable datetime string → epoch ms. */
export function parseTimestampToMs(raw: unknown): number | null {
	const v = unwrapDateTime(raw);
	if (v === null || v === undefined || v === "") return null;
	if (typeof v === "number" && Number.isFinite(v)) {
		if (v <= 0) return null;
		return v < 1e12 ? v * 1000 : v;
	}
	const s = String(v).trim();
	if (!s) return null;
	if (/^\d+(\.\d+)?$/.test(s)) {
		const n = parseFloat(s);
		if (!Number.isFinite(n) || n <= 0) return null;
		return n < 1e12 ? n * 1000 : n;
	}
	const parsed = Date.parse(s);
	return Number.isFinite(parsed) ? parsed : null;
}

function optionalPositiveNumber(raw: unknown): number | null {
	if (raw === null || raw === undefined || raw === "") return null;
	const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
	if (!Number.isFinite(n) || n < 0) return null;
	return n;
}

function optionalSource(raw: unknown): string | null {
	if (raw === null || raw === undefined || raw === "") return null;
	const s = String(raw).trim();
	return s ? s : null;
}

function tryParseJson(raw: string): unknown | undefined {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function coercePayload(raw: unknown): unknown {
	if (typeof raw === "string") {
		const s = raw.trim();
		if (!s) return null;
		const parsed = tryParseJson(s);
		return parsed === undefined ? s : parsed;
	}
	return raw;
}

function slotFromPair(startMs: number, endMs: number, extra?: Partial<EvSmartPlanSlot>): EvSmartPlanSlot | null {
	if (!(endMs > startMs)) return null;
	const hasPower = extra?.plannedPowerKw != null;
	const hasEnergy = extra?.plannedEnergyKWh != null;
	return {
		start: isoFromMs(startMs),
		end: isoFromMs(endMs),
		plannedPowerKw: extra?.plannedPowerKw ?? null,
		plannedEnergyKWh: extra?.plannedEnergyKWh ?? null,
		source: extra?.source ?? null,
		quality: hasPower || hasEnergy ? "ok" : "degraded",
	};
}

function slotFromObject(obj: Record<string, unknown>): EvSmartPlanSlot | null {
	const map = lowerKeyMap(obj);
	const startMs = parseTimestampToMs(pickKey(map, START_KEYS));
	const endMs = parseTimestampToMs(pickKey(map, END_KEYS));
	if (startMs === null || endMs === null) return null;
	const energy = optionalPositiveNumber(pickKey(map, ENERGY_KWH_KEYS));
	let powerKw = optionalPositiveNumber(pickKey(map, POWER_KW_KEYS));
	if (powerKw === null) {
		const w = optionalPositiveNumber(pickKey(map, POWER_W_KEYS));
		if (w !== null) powerKw = w > 50 ? w / 1000 : w;
	}
	if (powerKw === null) {
		const generic = optionalPositiveNumber(map.get("power"));
		if (generic !== null) {
			powerKw = generic > 50 ? generic / 1000 : generic;
		}
	}
	return slotFromPair(startMs, endMs, {
		plannedPowerKw: powerKw,
		plannedEnergyKWh: energy,
		source: optionalSource(pickKey(map, SOURCE_KEYS)),
	});
}

function slotFromTuple(raw: unknown): EvSmartPlanSlot | null {
	if (!Array.isArray(raw) || raw.length < 2) return null;
	const startMs = parseTimestampToMs(raw[0]);
	const endMs = parseTimestampToMs(raw[1]);
	if (startMs === null || endMs === null) return null;
	const energy = raw.length > 2 ? optionalPositiveNumber(raw[2]) : null;
	return slotFromPair(startMs, endMs, { plannedEnergyKWh: energy });
}

function collectCandidateArrays(payload: unknown): unknown[][] {
	const out: unknown[][] = [];
	if (Array.isArray(payload)) {
		out.push(payload);
		return out;
	}
	if (!payload || typeof payload !== "object") return out;
	const obj = payload as Record<string, unknown>;
	const map = lowerKeyMap(obj);
	for (const key of NESTED_ARRAY_KEYS) {
		const v = map.get(key);
		if (Array.isArray(v)) out.push(v);
	}
	if (out.length === 0) {
		for (const v of Object.values(obj)) {
			if (Array.isArray(v) && v.length > 0 && (typeof v[0] === "object" || Array.isArray(v[0]))) {
				out.push(v);
			}
		}
	}
	return out;
}

function parseSlotList(list: unknown[]): { slots: EvSmartPlanSlot[]; ignored: number } {
	const slots: EvSmartPlanSlot[] = [];
	let ignored = 0;
	for (const item of list) {
		let slot: EvSmartPlanSlot | null = null;
		if (Array.isArray(item)) {
			slot = slotFromTuple(item);
		} else if (item && typeof item === "object") {
			slot = slotFromObject(item as Record<string, unknown>);
		}
		if (slot) slots.push(slot);
		else ignored += 1;
	}
	return { slots, ignored };
}

/**
 * Defensive smart-plan parser. Vendor field names are only aliases here — not planner knowledge.
 * Unparseable slots are ignored; no invented windows.
 */
export function parseSmartPlanPayload(raw: unknown): ParseSmartPlanResult {
	if (raw === null || raw === undefined || raw === "") {
		return { slots: [], ignoredCount: 0, parseable: false, error: null };
	}
	const payload = coercePayload(raw);
	if (payload === null || payload === undefined || payload === "") {
		return { slots: [], ignoredCount: 0, parseable: false, error: null };
	}
	if (typeof payload === "string") {
		return { slots: [], ignoredCount: 0, parseable: false, error: "unrecognized_payload" };
	}

	const arrays = collectCandidateArrays(payload);
	if (arrays.length > 0) {
		const slots: EvSmartPlanSlot[] = [];
		let ignored = 0;
		for (const list of arrays) {
			const part = parseSlotList(list);
			slots.push(...part.slots);
			ignored += part.ignored;
		}
		if (slots.length === 0 && ignored > 0) {
			return { slots: [], ignoredCount: ignored, parseable: false, error: "slots_unparseable" };
		}
		return { slots, ignoredCount: ignored, parseable: true, error: ignored > 0 ? "partial_slots_ignored" : null };
	}

	if (payload && typeof payload === "object") {
		const single = slotFromObject(payload as Record<string, unknown>);
		if (single) {
			return { slots: [single], ignoredCount: 0, parseable: true, error: null };
		}
		return { slots: [], ignoredCount: 0, parseable: false, error: "unrecognized_object" };
	}

	return { slots: [], ignoredCount: 0, parseable: false, error: "unrecognized_payload" };
}

export function parseStandaloneStartEnd(startRaw: unknown, endRaw: unknown): EvSmartPlanSlot | null {
	const startMs = parseTimestampToMs(startRaw);
	const endMs = parseTimestampToMs(endRaw);
	if (startMs === null || endMs === null) return null;
	return slotFromPair(startMs, endMs);
}

/** Clock time `HH:MM` / `H:MM` → next occurrence in timezone. ISO timestamps pass through. */
export function resolveDeadlineIso(
	raw: string | null,
	now: Date,
	timezone: string,
): string | null {
	if (!raw) return null;
	const s = raw.trim();
	if (!s) return null;
	const isoMs = parseTimestampToMs(s);
	if (isoMs !== null && /[tT]|\d{4}-\d{2}-\d{2}/.test(s)) {
		return isoFromMs(isoMs);
	}
	const m = /^(\d{1,2}):(\d{2})$/.exec(s);
	if (!m) {
		return isoMs !== null ? isoFromMs(isoMs) : null;
	}
	const hour = parseInt(m[1], 10);
	const minute = parseInt(m[2], 10);
	if (hour > 23 || minute > 59) return null;
	const tz = timezone.trim() || "Europe/Berlin";
	const today = localDateKeyInTimezone(now, tz);
	let candidate = isoAtTimezoneLocal(today, hour, minute, tz);
	if (Date.parse(candidate) <= now.getTime()) {
		candidate = isoAtTimezoneLocal(addDaysToDateKey(today, 1), hour, minute, tz);
	}
	return candidate;
}

export function previewRaw(raw: unknown, max = 4000): string | null {
	if (raw === null || raw === undefined) return null;
	try {
		const s = typeof raw === "string" ? raw : JSON.stringify(raw);
		if (!s) return null;
		return s.length > max ? `${s.slice(0, max)}…` : s;
	} catch {
		return String(raw).slice(0, max);
	}
}
