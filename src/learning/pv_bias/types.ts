/** Tagespaar Ist vs. eingefrorener Forecast — nur valide Zahlen, keine Platzhalter-Nullen. */
export type PvBiasDayPair = {
	dayOffset: number;
	actualKwh: number;
	forecastKwh: number;
};

export type PvBiasConfig = {
	enabled: boolean;
	historyActualStateId: string;
	historyForecastStateId: string;
	rawTodayStateId: string;
	rawTomorrowStateId: string;
	intervalSec: number;
	freezeEnabled: boolean;
	freezeTime: string;
	actualSnapshotEnabled: boolean;
	actualSnapshotTime: string;
};

export type PvBiasComputeResult = {
	biasTodayPct: number | null;
	bias7dPct: number | null;
	bias30dPct: number | null;
	bias14dPct: number | null;
	bias90dPct: number | null;
	modelBiasPct: number | null;
	appliedBiasPct: number | null;
	sampleDays7d: number;
	sampleDays30d: number;
	sampleDays14d: number;
	sampleDays90d: number;
	coveragePct: number;
	stabilityPct: number;
	confidencePct: number;
	correctedTodayKwh: number | null;
	correctedTomorrowKwh: number | null;
	rawTodayKwh: number | null;
	rawTomorrowKwh: number | null;
	status: "ready" | "insufficient_data" | "no_config" | "error";
	reason: string;
};

export type ForecastFreezeStatus = "ready" | "waiting" | "disabled" | "error";

export type ForecastFreezeDecision = {
	shouldFreeze: boolean;
	status: ForecastFreezeStatus;
	reason: string;
};

export type ForecastFreezeSnapshot = {
	frozenAtTs: string;
	freezeTime: string;
	frozenTodayKwh: number;
	frozenTomorrowKwh: number | null;
	frozenSource: string;
};
