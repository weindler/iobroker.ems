import { ensurePvHorizonStates } from "./ensure_states";

export { runPvHorizon, type PvHorizonRunHost } from "./run";
export { computePvHorizon, effectiveBiasPct, horizonDayConfidencePct } from "./math";
export {
	PV_HORIZON_BIAS_WEIGHT_BY_DAY,
	PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY,
} from "./constants";

export async function ensurePvHorizonLearningStates(host: Parameters<typeof ensurePvHorizonStates>[0]): Promise<void> {
	await ensurePvHorizonStates(host);
}
