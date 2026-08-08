/**
 * Autoritative Thermal-Zieltemperatur für Runtime/FSM (Befund 004 Split-Brain-Fix).
 *
 * Bei gültigem Unified/Daily Plan: effectiveTargetTempC (Forecast → Bridge → Precharge).
 * Sonst: sicherer Forecast-/Force-Fallback. Nie über planningMax.
 */

export type ThermalTargetAuthorityInput = {
	/** Daily Plan besitzt den Slot (valid oder zero-allocation). */
	useDailyPlan: boolean;
	dailyPlanRevision: number | null;
	/** Mit dem Plan publiziertes effektives Ziel; null = fehlt. */
	planEffectiveTargetTempC: number | null;
	/** Revision, mit der das effektive Ziel geschrieben wurde. */
	planTargetRevision: number | null;
	/** Forecast-Basisziel (resolveThermalForecastTarget). */
	forecastTargetTempC: number | null;
	/** Force-Modus-Ziel. */
	forceTargetTempC: number | null;
	resolvedMode: "off" | "auto" | "force";
	planningMinTempC: number;
	planningMaxTempC: number;
	/** Effektive Plan-Begründung (Contribution); Fallback Forecast-Text. */
	planTargetReasonDe: string | null;
	forecastReasonDe: string;
};

export type ThermalTargetAuthorityResult = {
	/** FSM-Ceiling / VIS-Primärziel. */
	authoritativeTargetTempC: number | null;
	/** Immer Forecast-Basis wenn bekannt (VIS „Basis“). */
	forecastTargetTempC: number | null;
	reasonDe: string;
	source: "daily_plan_effective" | "forecast" | "force" | "off" | "safe_min";
};

function clampTemp(min: number, max: number, t: number): number {
	return Math.min(max, Math.max(min, t));
}

function finiteOrNull(n: number | null | undefined): number | null {
	return n !== null && n !== undefined && Number.isFinite(n) ? n : null;
}

/**
 * Revision muss zum Daily Plan passen — verhindert stale Precharge-Ziele.
 */
export function planTargetRevisionMatches(
	planTargetRevision: number | null,
	dailyPlanRevision: number | null,
): boolean {
	if (planTargetRevision === null || dailyPlanRevision === null) return false;
	return planTargetRevision === dailyPlanRevision;
}

export function resolveAuthoritativeThermalTarget(
	input: ThermalTargetAuthorityInput,
): ThermalTargetAuthorityResult {
	const min = input.planningMinTempC;
	const max = input.planningMaxTempC;
	const forecast = finiteOrNull(input.forecastTargetTempC);
	const forecastClamped = forecast !== null ? clampTemp(min, max, forecast) : null;

	if (input.resolvedMode === "off") {
		return {
			authoritativeTargetTempC: null,
			forecastTargetTempC: forecastClamped,
			reasonDe: "Modus off — kein Heiz-Tagesziel.",
			source: "off",
		};
	}

	if (input.resolvedMode === "force") {
		const force = finiteOrNull(input.forceTargetTempC) ?? max;
		return {
			authoritativeTargetTempC: clampTemp(min, max, force),
			forecastTargetTempC: forecastClamped,
			reasonDe: `Force-Ziel ${clampTemp(min, max, force)} °C.`,
			source: "force",
		};
	}

	const effective = finiteOrNull(input.planEffectiveTargetTempC);
	const revOk = planTargetRevisionMatches(input.planTargetRevision, input.dailyPlanRevision);
	if (input.useDailyPlan && effective !== null && revOk) {
		const t = clampTemp(min, max, effective);
		const reason =
			(input.planTargetReasonDe && input.planTargetReasonDe.trim()) ||
			`Unified-Plan-Ziel ${t} °C (Revision ${input.dailyPlanRevision}).`;
		return {
			authoritativeTargetTempC: t,
			forecastTargetTempC: forecastClamped,
			reasonDe: reason,
			source: "daily_plan_effective",
		};
	}

	if (forecastClamped !== null) {
		return {
			authoritativeTargetTempC: forecastClamped,
			forecastTargetTempC: forecastClamped,
			reasonDe: input.forecastReasonDe || `Forecast-Ziel ${forecastClamped} °C.`,
			source: "forecast",
		};
	}

	return {
		authoritativeTargetTempC: min,
		forecastTargetTempC: null,
		reasonDe: `Sicherheits-Untergrenze ${min} °C (kein Forecast/Plan-Ziel).`,
		source: "safe_min",
	};
}

/**
 * Grobe Konsistenz: Energy-Headroom ↔ ΔT × kWh/°C (Default 0.38).
 * Toleranz für Learning-Marge / Rundung.
 */
export function thermalEnergyMatchesTargetTemp(opts: {
	bufferTempC: number;
	effectiveTargetTempC: number;
	requiredEnergyKwh: number;
	kwhPerDegreeC?: number;
	toleranceKwh?: number;
}): boolean {
	const k = opts.kwhPerDegreeC ?? 0.38;
	const delta = opts.effectiveTargetTempC - opts.bufferTempC;
	if (delta <= 0) return opts.requiredEnergyKwh <= (opts.toleranceKwh ?? 0.35);
	const expected = delta * k;
	const tol = opts.toleranceKwh ?? Math.max(0.5, expected * 0.35);
	return Math.abs(opts.requiredEnergyKwh - expected) <= tol;
}
