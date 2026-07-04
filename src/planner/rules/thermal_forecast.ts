import type { ImmersionDeviceConfig } from "../../addons/immersion_heater/runtime/types";

export interface ThermalForecastInput {
	config: ImmersionDeviceConfig;
	bufferTempC: number | null;
	pvTodayKwh: number | null;
	pvTomorrowKwh: number | null;
	pvBiasStatus: string | null;
	forecastModeEnabled: boolean;
	aiOptimizationAllowed: boolean;
}

export interface ThermalForecastResult {
	targetTempC: number;
	targetReasonDe: string;
	forecastActive: boolean;
}

function targetFromFraction(config: ImmersionDeviceConfig, fraction: number): number {
	const span = config.planningMaxTempC - config.planningMinTempC;
	return Math.round((config.planningMinTempC + span * fraction) * 10) / 10;
}

function clampTarget(config: ImmersionDeviceConfig, targetC: number): number {
	return Math.min(config.planningMaxTempC, Math.max(config.planningMinTempC, targetC));
}

/** Regelbasiertes Tagesziel (Phase B) — nur wenn Forecast-Modus an und KI aus. */
export function resolveThermalForecastTarget(input: ThermalForecastInput): ThermalForecastResult {
	const { config } = input;
	const max = config.planningMaxTempC;

	if (!input.forecastModeEnabled) {
		return {
			targetTempC: max,
			targetReasonDe: "Forecast-Modus aus — Ziel = Planungsobergrenze.",
			forecastActive: false,
		};
	}

	if (input.aiOptimizationAllowed) {
		return {
			targetTempC: max,
			targetReasonDe: "KI-Optimierung aktiv — regelbasierter Forecast wartet auf KI-Anbindung.",
			forecastActive: false,
		};
	}

	if (input.bufferTempC !== null && input.bufferTempC < config.planningMinTempC) {
		return {
			targetTempC: config.planningMinTempC,
			targetReasonDe: `Puffer ${input.bufferTempC.toFixed(1)} °C unter Mindeststand ${config.planningMinTempC} °C — aufholen.`,
			forecastActive: true,
		};
	}

	const today = input.pvTodayKwh;
	const tomorrow = input.pvTomorrowKwh;
	const hasPvForecast =
		today !== null &&
		today > 0 &&
		tomorrow !== null &&
		tomorrow >= 0 &&
		input.pvBiasStatus !== "disabled" &&
		input.pvBiasStatus !== "no_config";

	if (!hasPvForecast) {
		const target = clampTarget(config, max - config.forecastNoDataOffsetC);
		return {
			targetTempC: target,
			targetReasonDe: `Keine PV-Prognose — konservatives Tagesziel ${target} °C.`,
			forecastActive: true,
		};
	}

	if (tomorrow < today * config.forecastLowTomorrowRatio) {
		return {
			targetTempC: max,
			targetReasonDe: `PV morgen (${tomorrow.toFixed(1)} kWh) deutlich unter heute (${today.toFixed(1)} kWh) — Speicher voll (${max} °C).`,
			forecastActive: true,
		};
	}

	if (tomorrow >= today * config.forecastHighTomorrowRatio) {
		const target = targetFromFraction(config, config.forecastTargetFractionModerate);
		return {
			targetTempC: target,
			targetReasonDe: `PV morgen (${tomorrow.toFixed(1)} kWh) ähnlich/höher wie heute (${today.toFixed(1)} kWh) — moderates Ziel ${target} °C.`,
			forecastActive: true,
		};
	}

	const target = targetFromFraction(config, config.forecastTargetFractionDefault);
	return {
		targetTempC: target,
		targetReasonDe: `Standard-Tagesziel ${target} °C (PV heute ${today.toFixed(1)}, morgen ${tomorrow.toFixed(1)} kWh).`,
		forecastActive: true,
	};
}
