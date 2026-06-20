export type PriceUnit = "ct_per_kwh" | "eur_per_kwh";

export const PLAUSIBLE_CT_MIN = 0;
export const PLAUSIBLE_CT_MAX = 500;
export const PLAUSIBLE_EUR_MIN = 0;
export const PLAUSIBLE_EUR_MAX = 5;

export function detectPriceUnit(stateId: string, unit?: string): PriceUnit {
	const u = (unit ?? "").toLowerCase();
	if (u.includes("ct") || stateId.includes("ct_per_kwh")) {
		return "ct_per_kwh";
	}
	if (u.includes("eur") || u.includes("€") || u.includes("euro")) {
		return "eur_per_kwh";
	}
	return stateId.includes("ct_per_kwh") ? "ct_per_kwh" : "eur_per_kwh";
}

export function isValidPriceValue(value: number | null, unit: PriceUnit): value is number {
	if (value === null || !Number.isFinite(value)) {
		return false;
	}
	if (unit === "ct_per_kwh") {
		return value >= PLAUSIBLE_CT_MIN && value <= PLAUSIBLE_CT_MAX;
	}
	return value >= PLAUSIBLE_EUR_MIN && value <= PLAUSIBLE_EUR_MAX;
}

export function toEurPerKwh(value: number, unit: PriceUnit): number {
	return unit === "ct_per_kwh" ? value / 100 : value;
}

export function toCtPerKwh(valueEur: number): number {
	return valueEur * 100;
}

export function eurToCt(value: number, unit: PriceUnit): number {
	return unit === "ct_per_kwh" ? value : value * 100;
}

export async function resolvePriceUnit(
	host: { getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined> },
	stateId: string,
): Promise<PriceUnit> {
	if (!host.getObjectAsync) {
		return detectPriceUnit(stateId);
	}
	try {
		const obj = await host.getObjectAsync(stateId);
		const unit =
			obj?.common && typeof obj.common === "object"
				? String((obj.common as { unit?: string }).unit ?? "")
				: "";
		return detectPriceUnit(stateId, unit);
	} catch {
		return detectPriceUnit(stateId);
	}
}
