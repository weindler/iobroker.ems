export type PvHorizonDayResult = {
	dayIndex: number;
	rawKwh: number | null;
	correctedKwh: number | null;
	confidencePct: number | null;
};

export type PvHorizonComputeResult = {
	days: PvHorizonDayResult[];
	total7dRawKwh: number | null;
	total7dCorrectedKwh: number | null;
	daysAvailable: number;
	status: "ready" | "partial" | "no_data" | "no_bias" | "disabled";
};

export type PvHorizonConfig = {
	enabled: boolean;
	rawStateIds: string[];
};
