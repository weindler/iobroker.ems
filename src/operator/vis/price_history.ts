/**
 * Verlauf der echten Preise (ct/kWh je Viertelstunde) für den Rückblick der Preisgrafik.
 * Reine Anzeige-Daten: gespeichert wird nur, was bereits als veröffentlichter Preis vorliegt.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";

export const PRICE_HISTORY_CATEGORY = "learning/vis_price_history";
export const PRICE_HISTORY_FILE = "price_history_v1.json";
export const PRICE_HISTORY_KEEP_MS = 72 * 3_600_000;

/** Startzeit (ms) -> echter Preis (ct/kWh). */
export type PriceMap = Record<string, number>;
export interface PriceHistory {
	version: 1;
	a: PriceMap;
}

export function emptyPriceHistory(): PriceHistory {
	return { version: 1, a: {} };
}

export async function readPriceHistory(dir: string): Promise<PriceHistory> {
	try {
		const p = JSON.parse(await fs.readFile(path.join(dir, PRICE_HISTORY_FILE), "utf8")) as Record<string, unknown>;
		if (p?.version === 1 && p.a && typeof p.a === "object") {
			const a: PriceMap = {};
			for (const [k, v] of Object.entries(p.a as Record<string, unknown>)) {
				if (/^\d{10,14}$/.test(k) && typeof v === "number" && Number.isFinite(v)) a[k] = v;
			}
			return { version: 1, a };
		}
	} catch {
		/* neu anlegen */
	}
	return emptyPriceHistory();
}

export async function writePriceHistory(dir: string, h: PriceHistory): Promise<void> {
	await fs.mkdir(dir, { recursive: true });
	await atomicWriteFile(path.join(dir, PRICE_HISTORY_FILE), `${JSON.stringify(h)}\n`);
}

/**
 * Echte (nicht prognostizierte) Preise einmischen. Bereits Gespeichertes bleibt unverändert,
 * außer der Preis wurde nachträglich korrigiert. Älteres als 72 h entfällt.
 * `changed` ist false, wenn nichts neu ist (dann muss nicht geschrieben werden).
 */
export function mergePriceHistory(
	prev: PriceHistory,
	nowMs: number,
	actual: Iterable<[number, number]>,
): { history: PriceHistory; changed: boolean } {
	const a: PriceMap = { ...prev.a };
	let changed = false;
	for (const [start, ct] of actual) {
		if (!Number.isFinite(start) || !Number.isFinite(ct)) continue;
		if (start < nowMs - PRICE_HISTORY_KEEP_MS) continue;
		const key = String(start);
		const v = Math.round(ct * 1000) / 1000;
		if (a[key] !== v) {
			a[key] = v;
			changed = true;
		}
	}
	for (const key of Object.keys(a)) {
		if (nowMs - Number(key) > PRICE_HISTORY_KEEP_MS) {
			delete a[key];
			changed = true;
		}
	}
	return { history: { version: 1, a }, changed };
}
