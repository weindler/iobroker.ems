/**
 * Tarif-Tab (Tibber): monatliche Grundgebühr + monatliches Netzentgelt → economics.config.
 * Verivox/Statistik-Festtarif bleibt separat (dort alles im Vergleichstarif enthalten).
 */

import { setOptionalNumberIfChanged } from "../policy/core/state_write";
import type { StateHost } from "./state_util";

export const TARIFF_MONTHLY_BASE_EUR_NATIVE_KEY = "tariff_monthly_base_eur";
export const TARIFF_GRID_FEE_MONTHLY_EUR_NATIVE_KEY = "tariff_grid_fee_monthly_eur";

export const ECONOMICS_MONTHLY_BASE_FEE_EUR_STATE = "economics.config.monthly_base_fee_eur";
export const ECONOMICS_GRID_FEE_MONTHLY_EUR_STATE = "economics.config.grid_fee_monthly_eur";

export type EconomicsTariffFeesHost = StateHost & {
	config: unknown;
	log?: { info?: (m: string) => void; warn?: (m: string) => void; debug?: (m: string) => void };
};

function normalizeNonNeg(raw: unknown): number | null {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
	return raw;
}

export function readNativeTariffMonthlyBaseEur(config: unknown): number | null {
	if (!config || typeof config !== "object") return null;
	return normalizeNonNeg((config as Record<string, unknown>)[TARIFF_MONTHLY_BASE_EUR_NATIVE_KEY]);
}

export function readNativeTariffGridFeeMonthlyEur(config: unknown): number | null {
	if (!config || typeof config !== "object") return null;
	return normalizeNonNeg((config as Record<string, unknown>)[TARIFF_GRID_FEE_MONTHLY_EUR_NATIVE_KEY]);
}

export async function syncEconomicsTariffFeesFromConfig(host: EconomicsTariffFeesHost): Promise<{
	monthlyBaseEur: number | null;
	gridFeeMonthlyEur: number | null;
	mirrored: boolean;
}> {
	await host.setObjectNotExistsAsync(ECONOMICS_GRID_FEE_MONTHLY_EUR_STATE, {
		type: "state",
		common: {
			name: "Economics Netzentgelt / Monat (Tibber)",
			type: "number",
			role: "value",
			unit: "EUR",
			read: true,
			write: false,
		},
		native: {},
	} as ioBroker.Object);

	const monthly = readNativeTariffMonthlyBaseEur(host.config);
	const gridMonthly = readNativeTariffGridFeeMonthlyEur(host.config);
	let mirrored = false;
	mirrored =
		(await setOptionalNumberIfChanged(host, ECONOMICS_MONTHLY_BASE_FEE_EUR_STATE, monthly)) || mirrored;
	mirrored =
		(await setOptionalNumberIfChanged(host, ECONOMICS_GRID_FEE_MONTHLY_EUR_STATE, gridMonthly)) ||
		mirrored;
	return { monthlyBaseEur: monthly, gridFeeMonthlyEur: gridMonthly, mirrored };
}
