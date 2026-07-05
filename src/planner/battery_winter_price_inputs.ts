import { priceForecastConfigFromAdapter } from "../learning/price_forecast/config";
import {
	parseTibberPriceJsonTo15MinSlots,
	type Price15MinSlot,
} from "../learning/price_forecast/tibber_parse";
import type { PlannerHost } from "./inputs";

async function readForeignVal(host: PlannerHost, stateId: string): Promise<unknown> {
	if (!stateId.trim()) return null;
	const tryRead = async (
		fn?: (id: string) => Promise<ioBroker.State | null | undefined>,
	): Promise<unknown> => {
		if (!fn) return null;
		try {
			const st = await fn.call(host, stateId);
			return st?.val ?? null;
		} catch {
			return null;
		}
	};
	const foreign = await tryRead(host.getForeignStateAsync);
	if (foreign !== null && foreign !== undefined) return foreign;
	return tryRead(host.getStateAsync);
}

/** Liest Tibber Today/Tomorrow-JSON und liefert sortierte 15-min-Preisslots ab jetzt. */
export async function readTibber15MinPriceSlots(host: PlannerHost, now: Date): Promise<Price15MinSlot[]> {
	const cfg = priceForecastConfigFromAdapter(host.config);
	if (!cfg.todayJsonStateId && !cfg.tomorrowJsonStateId) {
		return [];
	}

	const minStartMs = now.getTime();
	const byStart = new Map<number, Price15MinSlot>();

	for (const stateId of [cfg.todayJsonStateId, cfg.tomorrowJsonStateId]) {
		if (!stateId) continue;
		const raw = await readForeignVal(host, stateId);
		for (const slot of parseTibberPriceJsonTo15MinSlots(raw, { minStartMs })) {
			byStart.set(slot.slotStartMs, slot);
		}
	}

	return [...byStart.values()].sort((a, b) => a.slotStartMs - b.slotStartMs);
}
