/** Neutral grid-supply data quality — shared by operator runtime and planner preparation. */
export type GridDataStatus =
	| "valid"
	| "degraded"
	| "missing"
	| "disabled"
	| "invalid"
	| "blocked"
	| "unsupported";

export interface GridDataQuality {
	status: GridDataStatus;
	confidencePct: number | null;
	reasonDe: string;
}

export type GridSupplySource = "dynamic_tariff" | "price_learning_fallback" | "fixed_tariff" | "none";

export type GridPriceLabel = "cheap" | "normal" | "expensive" | null;

export interface GridSupplySlot {
	startIso: string;
	endIso: string;
	priceCtPerKwh: number | null;
	importAllowed: boolean;
	maxImportPowerW: number | null;
	priceLabel: GridPriceLabel;
	quality: GridDataQuality;
}

export interface GridSupplyForecast {
	generatedAt: string;
	validUntil: string | null;
	source: GridSupplySource;
	currentPriceCtPerKwh: number | null;
	gridImportAllowed: boolean;
	configuredMaxGridImportW: number | null;
	configuredHouseFuseLimitW: number | null;
	effectiveMaxGridImportW: number | null;
	slots: GridSupplySlot[];
	quality: GridDataQuality;
	reasonDe: string;
}
