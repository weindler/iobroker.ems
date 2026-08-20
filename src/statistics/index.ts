export { statisticsConfigFromAdapter } from "./config";
export { ensureStatisticsStateTree, STATISTICS_STATES } from "./ensure_states";
export {
	tickStatistics,
	handleStatisticsStateChange,
	isStatisticsRelatedState,
	__resetStatisticsForTest,
	type StatisticsHost,
} from "./tick";
export type * from "./types";
