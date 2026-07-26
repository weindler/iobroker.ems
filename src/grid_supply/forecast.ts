import type { GlobalMode } from "../global_modes/constants";
import { isGlobalMode } from "../global_modes/config";
import type { Price15MinSlot } from "../learning/price_forecast/tibber_parse";
import { gridDataQuality } from "./quality";
import { isValidIsoTimestamp, isoFromMs, slotEndMsFromStart } from "./time";
import type {
	GridDataQuality,
	GridPriceLabel,
	GridSupplyForecast,
	GridSupplySlot,
	GridSupplySource,
} from "./types";

export interface GridSupplyBuildInput {
	now: Date;
	globalMode: string | null;
	policyGridImportAllowed: boolean | null;
	configuredMaxGridImportW: number | null;
	configuredHouseFuseLimitW: number | null;
	currentPriceCtPerKwh: number | null;
	fixedPriceCtPerKwh: number | null;
	dynamicSlots: Price15MinSlot[];
	/**
	 * `learning.price_learning.*` — Tibber-Fallback (Block 1.3), NUR genutzt wenn `dynamicSlots`
	 * leer sind (z. B. Tibber-Feed vorübergehend ohne Daten). Nie ein Ersatz für eine echte
	 * dynamische Preiskurve — liefert lediglich einen gelernten Durchschnittspreis statt "keine Quelle".
	 */
	priceLearningStatus?: string | null;
	priceLearningAvgPrice7dEur?: number | null;
	priceLearningAvgPrice30dEur?: number | null;
	priceLearningAvgPrice90dEur?: number | null;
}

const PRICE_LEARNING_FALLBACK_HORIZON_HOURS = 48;

function priceLearningFallbackCtPerKwh(input: GridSupplyBuildInput): number | null {
	if (input.priceLearningStatus !== "ready") return null;
	const eur =
		input.priceLearningAvgPrice7dEur ?? input.priceLearningAvgPrice30dEur ?? input.priceLearningAvgPrice90dEur;
	if (eur === null || eur === undefined || !Number.isFinite(eur) || eur < 0) return null;
	return Math.round(eur * 100 * 100) / 100;
}

/**
 * Flacher gelernter Preis für den Fallback-Horizont — `price_learning` liefert nur einen
 * Durchschnittswert (keine Stunden-Preiskurve), daher keine erfundene Preis-Varianz pro Slot.
 */
function buildPriceLearningFallbackSlots(
	now: Date,
	priceCtPerKwh: number,
	flexibleImportAllowed: boolean,
	effectiveMaxImportW: number | null,
): GridSupplySlot[] {
	const slots: GridSupplySlot[] = [];
	const slotCount = (PRICE_LEARNING_FALLBACK_HORIZON_HOURS * 60) / 15;
	const startMs = now.getTime();
	for (let i = 0; i < slotCount; i++) {
		const slotStartMs = startMs + i * 15 * 60_000;
		slots.push({
			startIso: isoFromMs(slotStartMs),
			endIso: isoFromMs(slotEndMsFromStart(slotStartMs)),
			priceCtPerKwh,
			importAllowed: flexibleImportAllowed,
			maxImportPowerW: effectiveMaxImportW,
			priceLabel: "normal",
			quality: gridDataQuality(
				"degraded",
				"Price-Learning-Fallback (gelernter Ø-Preis, keine Stunden-Kurve)",
			),
		});
	}
	return slots;
}

export function computeEffectiveMaxGridImportW(
	maxGridImportW: number | null,
	houseFuseLimitW: number | null,
): number | null {
	const limits: number[] = [];
	if (maxGridImportW !== null && Number.isFinite(maxGridImportW) && maxGridImportW > 0) {
		limits.push(maxGridImportW);
	}
	if (houseFuseLimitW !== null && Number.isFinite(houseFuseLimitW) && houseFuseLimitW > 0) {
		limits.push(houseFuseLimitW);
	}
	if (limits.length === 0) return null;
	return Math.min(...limits);
}

export function resolveFlexibleGridImportAllowed(
	globalMode: string | null,
	policyGridImportAllowed: boolean | null,
): boolean {
	const mode: GlobalMode = globalMode && isGlobalMode(globalMode) ? globalMode : "balanced";
	if (mode === "off") {
		return false;
	}
	if (policyGridImportAllowed === false) {
		return false;
	}
	return true;
}

function medianPrice(slots: Array<{ priceCtPerKwh: number | null }>): number | null {
	const prices = slots
		.map((s) => s.priceCtPerKwh)
		.filter((p): p is number => p !== null && Number.isFinite(p));
	if (prices.length === 0) return null;
	const sorted = [...prices].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) {
		return sorted[mid];
	}
	return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function classifyGridPriceLabel(
	priceCtPerKwh: number | null,
	referenceMedianCt: number | null,
): GridPriceLabel {
	if (priceCtPerKwh === null || !Number.isFinite(priceCtPerKwh)) return null;
	if (referenceMedianCt === null || !Number.isFinite(referenceMedianCt)) return "normal";
	if (priceCtPerKwh <= referenceMedianCt * 0.95) return "cheap";
	if (priceCtPerKwh >= referenceMedianCt * 1.05) return "expensive";
	return "normal";
}

function normalizeDynamicSlots(
	rawSlots: Price15MinSlot[],
	flexibleImportAllowed: boolean,
	effectiveMaxImportW: number | null,
	referenceMedianCt: number | null,
): GridSupplySlot[] {
	const byStart = new Map<string, GridSupplySlot>();

	for (const raw of rawSlots) {
		if (!Number.isFinite(raw.slotStartMs)) continue;
		const startIso = isoFromMs(raw.slotStartMs);
		const endIso = isoFromMs(slotEndMsFromStart(raw.slotStartMs));
		if (!isValidIsoTimestamp(startIso) || !isValidIsoTimestamp(endIso)) continue;

		const priceCtPerKwh =
			Number.isFinite(raw.priceCtPerKwh) && raw.priceCtPerKwh >= 0 ? raw.priceCtPerKwh : null;

		const slot: GridSupplySlot = {
			startIso,
			endIso,
			priceCtPerKwh,
			importAllowed: flexibleImportAllowed,
			maxImportPowerW: effectiveMaxImportW,
			priceLabel: classifyGridPriceLabel(priceCtPerKwh, referenceMedianCt),
			quality: gridDataQuality(
				priceCtPerKwh === null ? "missing" : "valid",
				priceCtPerKwh === null ? "Preis für Slot unbekannt" : "Dynamischer Tarif-Slot",
			),
		};

		const existing = byStart.get(startIso);
		if (!existing) {
			byStart.set(startIso, slot);
			continue;
		}
		if (existing.priceCtPerKwh === null && slot.priceCtPerKwh !== null) {
			byStart.set(startIso, slot);
		}
	}

	return [...byStart.values()].sort((a, b) => a.startIso.localeCompare(b.startIso));
}

function resolveSourceAndCurrentPrice(input: GridSupplyBuildInput): {
	source: GridSupplySource;
	currentPriceCtPerKwh: number | null;
	quality: GridDataQuality;
	reasonPart: string;
} {
	if (input.dynamicSlots.length > 0) {
		const current =
			input.currentPriceCtPerKwh !== null && Number.isFinite(input.currentPriceCtPerKwh)
				? input.currentPriceCtPerKwh
				: null;
		return {
			source: "dynamic_tariff",
			currentPriceCtPerKwh: current,
			quality: gridDataQuality("valid", "Dynamischer Tarif mit Preis-Slots verfügbar"),
			reasonPart: "Dynamischer Tarif aktiv",
		};
	}

	const learnedFallback = priceLearningFallbackCtPerKwh(input);
	if (learnedFallback !== null) {
		return {
			source: "price_learning_fallback",
			currentPriceCtPerKwh: learnedFallback,
			quality: gridDataQuality(
				"degraded",
				"Price-Learning-Fallback — keine aktuellen Tarif-Slots, gelernter Ø-Preis genutzt",
				null,
			),
			reasonPart: "Price-Learning-Fallback (gelernter Ø-Preis)",
		};
	}

	if (input.fixedPriceCtPerKwh !== null && Number.isFinite(input.fixedPriceCtPerKwh) && input.fixedPriceCtPerKwh >= 0) {
		return {
			source: "fixed_tariff",
			currentPriceCtPerKwh: input.fixedPriceCtPerKwh,
			quality: gridDataQuality("degraded", "Festpreis-Fallback — keine dynamischen Slots"),
			reasonPart: "Festpreis-Fallback",
		};
	}

	const current =
		input.currentPriceCtPerKwh !== null && Number.isFinite(input.currentPriceCtPerKwh)
			? input.currentPriceCtPerKwh
			: null;

	return {
		source: "none",
		currentPriceCtPerKwh: current,
		quality: gridDataQuality("missing", "Keine Preisquelle verfügbar"),
		reasonPart: current !== null ? "Aktueller Preis ohne Slot-Forecast" : "Preisquelle fehlt",
	};
}

export function buildGridSupplyForecast(input: GridSupplyBuildInput): GridSupplyForecast {
	const generatedAt = input.now.toISOString();
	const flexibleImportAllowed = resolveFlexibleGridImportAllowed(
		input.globalMode,
		input.policyGridImportAllowed,
	);
	const effectiveMaxGridImportW = computeEffectiveMaxGridImportW(
		input.configuredMaxGridImportW,
		input.configuredHouseFuseLimitW,
	);

	const { source, currentPriceCtPerKwh, quality: sourceQuality, reasonPart } =
		resolveSourceAndCurrentPrice(input);

	const normalizedDynamic = normalizeDynamicSlots(
		input.dynamicSlots,
		flexibleImportAllowed,
		effectiveMaxGridImportW,
		medianPrice(
			input.dynamicSlots.map((s) => ({
				priceCtPerKwh: Number.isFinite(s.priceCtPerKwh) ? s.priceCtPerKwh : null,
			})),
		),
	);

	const fallbackSlots =
		source === "price_learning_fallback" && currentPriceCtPerKwh !== null
			? buildPriceLearningFallbackSlots(input.now, currentPriceCtPerKwh, flexibleImportAllowed, effectiveMaxGridImportW)
			: [];
	const slots = normalizedDynamic.length > 0 ? normalizedDynamic : fallbackSlots;
	const validUntil = slots.length > 0 ? slots[slots.length - 1].endIso : null;

	let reasonDe = reasonPart;
	if (!flexibleImportAllowed) {
		if (input.globalMode && isGlobalMode(input.globalMode) && input.globalMode === "off") {
			reasonDe = "Global Mode off — flexible Netzenergie gesperrt";
		} else if (input.policyGridImportAllowed === false) {
			reasonDe = "Netzbezug durch Policy gesperrt";
		} else {
			reasonDe = "Flexible Netzenergie nicht erlaubt";
		}
	} else if (slots.length > 0) {
		reasonDe = `${reasonPart}; ${slots.length} Preis-Slots (15 min)`;
	}

	let quality = sourceQuality;
	if (!flexibleImportAllowed) {
		quality = gridDataQuality("disabled", reasonDe, quality.confidencePct);
	} else if (slots.length === 0 && source === "none") {
		quality = gridDataQuality("missing", reasonDe);
	} else if (slots.some((s) => s.priceCtPerKwh === null)) {
		quality = gridDataQuality("degraded", reasonDe);
	}

	return {
		generatedAt,
		validUntil,
		source,
		currentPriceCtPerKwh,
		gridImportAllowed: flexibleImportAllowed,
		configuredMaxGridImportW: input.configuredMaxGridImportW,
		configuredHouseFuseLimitW: input.configuredHouseFuseLimitW,
		effectiveMaxGridImportW,
		slots,
		quality,
		reasonDe,
	};
}

export function gridSlotsToPrice15Min(slots: GridSupplySlot[]): Price15MinSlot[] {
	const out: Price15MinSlot[] = [];
	for (const slot of slots) {
		if (slot.priceCtPerKwh === null || !Number.isFinite(slot.priceCtPerKwh)) continue;
		const startMs = Date.parse(slot.startIso);
		if (!Number.isFinite(startMs)) continue;
		out.push({ slotStartMs: startMs, priceCtPerKwh: slot.priceCtPerKwh });
	}
	return out.sort((a, b) => a.slotStartMs - b.slotStartMs);
}

export function medianPriceCtFromGridSupply(forecast: GridSupplyForecast): number | null {
	return medianPrice(forecast.slots);
}

export function gridSupplyRevisionPayload(forecast: GridSupplyForecast): string {
	return JSON.stringify({
		source: forecast.source,
		gridImportAllowed: forecast.gridImportAllowed,
		currentPriceCtPerKwh: forecast.currentPriceCtPerKwh,
		effectiveMaxGridImportW: forecast.effectiveMaxGridImportW,
		slots: forecast.slots.map((s) => ({
			startIso: s.startIso,
			endIso: s.endIso,
			priceCtPerKwh: s.priceCtPerKwh,
			importAllowed: s.importAllowed,
		})),
		qualityStatus: forecast.quality.status,
	});
}
