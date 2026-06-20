/**
 * Bias-Gewicht pro Horizon-Tag (Day1 = heute/nächster Tag, 100 % Bias).
 * Zentral dokumentiert — Änderungen nur hier und in EMS_LIGHT_PHASE_2B_PV_HORIZON.md.
 */
export const PV_HORIZON_BIAS_WEIGHT_BY_DAY: readonly number[] = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4];

/** Confidence-Abzug in Prozentpunkten pro Tag über Day1 (linear). */
export const PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY = 3;

export const PV_HORIZON_DAY_COUNT = 7;
