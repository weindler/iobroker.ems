import type { ImmersionDeviceConfig } from "../../addons/immersion_heater/runtime/types";

export interface ThermalForecastInput {
	config: ImmersionDeviceConfig;
	bufferTempC: number | null;
	pvTodayKwh: number | null;
	pvTomorrowKwh: number | null;
	pvBiasStatus: string | null;
	forecastModeEnabled: boolean;
	/**
	 * Reserviert für eine zukünftige echte KI-Zieltemperatur. Aktuell (v0.1.190) liefert die KI
	 * kein Tagesziel — dieses Feld beeinflusst `resolveThermalForecastTarget` bewusst nicht.
	 */
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

/**
 * Regelbasiertes Tagesziel (Phase B) — läuft unabhängig von der KI-Governance-Freigabe.
 *
 * `aiOptimizationAllowed` schaltet hier absichtlich nichts um: die KI liefert (Stand v0.1.190)
 * ausschließlich Slot-Präferenzen für den reinen Beobachtungs-Plan-Vergleich (`src/ai/compare/`),
 * nie ein eigenes Tagesziel. Solange keine echte KI-Zieltemperatur existiert, muss der bewährte
 * PV-Forecast (moderates Ziel bei ähnlicher PV-Prognose morgen) weiterlaufen — sonst heizt der
 * Heizstab bei aktivierter KI-Freigabe dauerhaft auf die Planungsobergrenze und erzeugt unnötige
 * Wärmeverluste, ohne dass die KI dafür etwas beigetragen hätte.
 */
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
