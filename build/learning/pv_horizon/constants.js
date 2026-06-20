"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PV_HORIZON_DAY_COUNT = exports.PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY = exports.PV_HORIZON_BIAS_WEIGHT_BY_DAY = void 0;
/**
 * Bias-Gewicht pro Horizon-Tag (Day1 = heute/nächster Tag, 100 % Bias).
 * Zentral dokumentiert — Änderungen nur hier und in EMS_LIGHT_PHASE_2B_PV_HORIZON.md.
 */
exports.PV_HORIZON_BIAS_WEIGHT_BY_DAY = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
/** Confidence-Abzug in Prozentpunkten pro Tag über Day1 (linear). */
exports.PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY = 3;
exports.PV_HORIZON_DAY_COUNT = 7;
