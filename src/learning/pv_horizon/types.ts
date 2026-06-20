export type PvHorizonDayResult = {
	dayIndex: number;
	rawKwh: number | null;
	correctedKwh: number | null;
	confidencePct: number | null;
};

export type PvHorizonStatus =
	| "ready"
	| "partial"
	| "no_data"
	| "no_bias"
	| "no_extended_days"
	| "disabled";

export type PvHorizonComputeResult = {
	days: PvHorizonDayResult[];
	total7dRawKwh: number | null;
	total7dCorrectedKwh: number | null;
	daysAvailable: number;
	expectedDays: number;
	skippedDayIndices: number[];
	status: PvHorizonStatus;
};

export type PvHorizonComputeOptions = {
	/** 1-basierte Tagesindizes, die nicht berechnet werden (z. B. 1+2 wenn PV-Bias heute/morgen liefert). */
	skipDayIndices?: number[];
};

export type PvHorizonConfig = {
	enabled: boolean;
	rawStateIds: string[];
	/** Heute/morgen kommen aus Phase-2A-PV-Forecast — Horizon nur Tag 3–7. */
	skipTodayTomorrowFromPvBias: boolean;
};
