/**
 * Vergleichstarif automatisch aktualisieren (optional, 1× pro Woche).
 *
 * Quelle: öffentliche Verivox-Seite „Strompreisentwicklung“ mit dem Neukunden-Durchschnitt
 * („rund 35 Cent pro Kilowattstunde brutto“, 4.000 kWh/Jahr, Arbeits- plus Grundpreis).
 * Es gibt keine offizielle Schnittstelle; schlägt das Lesen fehl, gilt der manuell eingetragene Preis.
 */
import * as https from "node:https";

export const VERIVOX_PRICE_URL = "https://www.verivox.de/strom/strompreisentwicklung/";
export const VERIVOX_REFERENCE_KWH_PER_YEAR = 4000;
export const COMPARE_TARIFF_REFETCH_MS = 7 * 24 * 3600 * 1000;
export const COMPARE_TARIFF_RETRY_MS = 6 * 3600 * 1000;
/** Älter als das gilt der automatische Wert nicht mehr (Fallback manuell). */
export const COMPARE_TARIFF_MAX_AGE_MS = 21 * 24 * 3600 * 1000;
const MAX_BYTES = 3 * 1024 * 1024;

export interface CompareTariffAuto {
	fetchedAt: string | null;
	attemptedAt: string | null;
	/** Neukunden-Durchschnitt brutto inkl. Grundpreis, ct/kWh. */
	bruttoCtPerKwh: number | null;
	/** Arbeitspreis allein (Grundpreis herausgerechnet), ct/kWh. */
	workCtPerKwh: number | null;
	status: "ok" | "error" | "none";
	errorDe: string | null;
}

export const EMPTY_COMPARE_TARIFF_AUTO: CompareTariffAuto = {
	fetchedAt: null,
	attemptedAt: null,
	bruttoCtPerKwh: null,
	workCtPerKwh: null,
	status: "none",
	errorDe: null,
};

/** „rund 35 Cent pro Kilowattstunde (kWh) brutto“ → 35. Null, wenn nicht plausibel (15–120 ct). */
export function parseVerivoxAveragePrice(html: string): number | null {
	const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|\s+/g, " ");
	const m = /(?:rund|ca\.?|circa)\s+(\d{1,3}(?:[.,]\d{1,2})?)\s*Cent\s+pro\s+Kilowattstunde/i.exec(text);
	if (!m) return null;
	const v = Number(m[1].replace(",", "."));
	return Number.isFinite(v) && v >= 15 && v <= 120 ? v : null;
}

/** Grundpreis (€/Monat) anteilig herausrechnen: der Verivox-Wert enthält ihn bei 4.000 kWh/Jahr. */
export function workPriceFromBrutto(bruttoCt: number, monthlyBaseEur: number): number {
	const baseCt = (Math.max(0, monthlyBaseEur) * 12 * 100) / VERIVOX_REFERENCE_KWH_PER_YEAR;
	return Math.max(0, Math.round((bruttoCt - baseCt) * 100) / 100);
}

export function shouldRefetch(auto: CompareTariffAuto, nowMs: number): boolean {
	const lastOk = auto.fetchedAt ? Date.parse(auto.fetchedAt) : NaN;
	const lastTry = auto.attemptedAt ? Date.parse(auto.attemptedAt) : NaN;
	if (Number.isFinite(lastTry) && nowMs - lastTry < COMPARE_TARIFF_RETRY_MS) return false;
	if (Number.isFinite(lastOk) && nowMs - lastOk < COMPARE_TARIFF_REFETCH_MS) return false;
	return true;
}

export function isAutoValueFresh(auto: CompareTariffAuto, nowMs: number): boolean {
	if (auto.status !== "ok" || auto.workCtPerKwh === null || !auto.fetchedAt) return false;
	const t = Date.parse(auto.fetchedAt);
	return Number.isFinite(t) && nowMs - t <= COMPARE_TARIFF_MAX_AGE_MS;
}

export function parseCompareTariffAuto(raw: unknown): CompareTariffAuto {
	try {
		const o = typeof raw === "string" ? JSON.parse(raw) : null;
		if (!o || typeof o !== "object") return { ...EMPTY_COMPARE_TARIFF_AUTO };
		const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
		const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
		const r = o as Record<string, unknown>;
		return {
			fetchedAt: str(r.fetchedAt),
			attemptedAt: str(r.attemptedAt),
			bruttoCtPerKwh: num(r.bruttoCtPerKwh),
			workCtPerKwh: num(r.workCtPerKwh),
			status: r.status === "ok" || r.status === "error" ? r.status : "none",
			errorDe: str(r.errorDe),
		};
	} catch {
		return { ...EMPTY_COMPARE_TARIFF_AUTO };
	}
}

function httpGetText(url: string, timeoutMs = 15000): Promise<string> {
	return new Promise((resolve, reject) => {
		const req = https.get(
			url,
			{ headers: { "User-Agent": "iobroker.ems (Preisvergleich, 1x pro Woche)", Accept: "text/html" }, timeout: timeoutMs },
			(res) => {
				if (res.statusCode !== 200) {
					res.resume();
					reject(new Error(`HTTP ${res.statusCode}`));
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				res.on("data", (c: Buffer) => {
					size += c.length;
					if (size > MAX_BYTES) {
						req.destroy(new Error("Antwort zu groß"));
						return;
					}
					chunks.push(c);
				});
				res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
				res.on("error", reject);
			},
		);
		req.on("timeout", () => req.destroy(new Error("Zeitüberschreitung")));
		req.on("error", reject);
	});
}

export async function fetchCompareTariff(
	prev: CompareTariffAuto,
	monthlyBaseEur: number,
	nowMs: number,
	fetchText: (url: string) => Promise<string> = httpGetText,
): Promise<CompareTariffAuto> {
	const attemptedAt = new Date(nowMs).toISOString();
	try {
		const brutto = parseVerivoxAveragePrice(await fetchText(VERIVOX_PRICE_URL));
		if (brutto === null) throw new Error("Preis auf der Seite nicht gefunden");
		return {
			fetchedAt: attemptedAt,
			attemptedAt,
			bruttoCtPerKwh: brutto,
			workCtPerKwh: workPriceFromBrutto(brutto, monthlyBaseEur),
			status: "ok",
			errorDe: null,
		};
	} catch (e) {
		return { ...prev, attemptedAt, status: prev.workCtPerKwh !== null ? prev.status : "error", errorDe: e instanceof Error ? e.message : String(e) };
	}
}
