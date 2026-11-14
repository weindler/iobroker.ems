/**
 * Energyforecast (energyforecast.de) API v2 — Antwort auswerten. Rein, ohne I/O.
 * Felder je Viertelstunde: start, end, price_ct_kwh (Markt), total_ct_kwh (inkl. Netzentgelt/Steuern,
 * laut Profil beim Anbieter), price_origin ("market" = echter Day-Ahead-Preis, "forecast" = Prognose).
 */

export const EF_SLOT_MS = 15 * 60 * 1000;

export type EfOrigin = "market" | "forecast" | "unknown";

export type EfSlot = {
	startMs: number;
	endMs: number;
	priceCt: number | null;
	totalCt: number;
	origin: EfOrigin;
};

export type EfParsed = {
	slots: EfSlot[];
	plan: string | null;
	generatedAtIso: string | null;
	validUntilIso: string | null;
};

function num(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function iso(v: unknown): string | null {
	if (typeof v !== "string") return null;
	return Number.isFinite(Date.parse(v)) ? v : null;
}

export function parseEnergyforecastResponse(raw: unknown): EfParsed {
	const root = (typeof raw === "string" ? safeJson(raw) : raw) as Record<string, unknown> | null;
	const rows = root && Array.isArray(root.data) ? (root.data as unknown[]) : [];
	const byStart = new Map<number, EfSlot>();
	for (const row of rows) {
		if (!row || typeof row !== "object") continue;
		const r = row as Record<string, unknown>;
		const startMs = typeof r.start === "string" ? Date.parse(r.start) : Number.NaN;
		const total = num(r.total_ct_kwh);
		// Plausibilitätsgrenzen (ct/kWh brutto) — alles andere ist kein Preis.
		if (!Number.isFinite(startMs) || total === null || total < -100 || total > 500) continue;
		const endParsed = typeof r.end === "string" ? Date.parse(r.end) : Number.NaN;
		const origin: EfOrigin = r.price_origin === "market" ? "market" : r.price_origin === "forecast" ? "forecast" : "unknown";
		byStart.set(startMs, {
			startMs,
			endMs: Number.isFinite(endParsed) ? endParsed : startMs + EF_SLOT_MS,
			priceCt: num(r.price_ct_kwh),
			totalCt: total,
			origin,
		});
	}
	const slots = [...byStart.values()].sort((a, b) => a.startMs - b.startMs);
	return {
		slots,
		plan: root && typeof root.plan === "string" ? root.plan : null,
		generatedAtIso: root ? iso(root.generated_at) : null,
		validUntilIso: root ? iso(root.valid_until) : null,
	};
}

function safeJson(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

/** Lokaler Kalendertag YYYY-MM-DD. */
export function localDay(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Anzahl voller Tage nach heute (>= 22 h an Slots, wegen Sommerzeitwechsel). */
export function fullDaysAhead(slots: EfSlot[], nowMs: number): number {
	const today = localDay(nowMs);
	const counts = new Map<string, number>();
	for (const s of slots) {
		const day = localDay(s.startMs);
		if (day > today) counts.set(day, (counts.get(day) ?? 0) + 1);
	}
	let n = 0;
	for (const c of counts.values()) if (c >= 88) n++;
	return n;
}

/** Slot, der gerade läuft. */
export function slotAt(slots: EfSlot[], nowMs: number): EfSlot | null {
	for (const s of slots) if (s.startMs <= nowMs && nowMs < s.endMs) return s;
	return null;
}

/** Token aus Fehlertexten entfernen — der Token darf nie in Logs oder States landen. */
export function redactToken(message: string, token: string): string {
	let out = message;
	if (token) out = out.split(token).join("***").split(encodeURIComponent(token)).join("***");
	return out.replace(/token=[^&\s"']+/gi, "token=***");
}
