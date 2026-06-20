import { ensurePvHorizonStates } from "./ensure_states";

export { runPvHorizon, type PvHorizonRunHost } from "./run";
export { computePvHorizon, effectiveBiasPct, horizonDayConfidencePct } from "./math";
export { hasPvForecastTodayTomorrow, pvHorizonConfigFromAdapter } from "./config";
export {
	PV_HORIZON_BIAS_WEIGHT_BY_DAY,
	PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY,
	PV_HORIZON_EXTENDED_FIRST_DAY,
	PV_HORIZON_EXTENDED_DAY_COUNT,
} from "./constants";

export async function ensurePvHorizonLearningStates(host: Parameters<typeof ensurePvHorizonStates>[0]): Promise<void> {
	await ensurePvHorizonStates(host);
}
