export type PriceOutlookKind = "published" | "estimated" | "unavailable";

export type PriceOutlookHour = {
	startIso: string;
	resolutionMinutes: 15 | 60;
	kind: PriceOutlookKind;
	source: "tibber" | "smard_brightsky" | "none";
	expectedCtPerKwh: number | null;
	minCtPerKwh: number | null;
	maxCtPerKwh: number | null;
	confidencePct: number | null;
};

export type PriceOutlookDay = {
	dateKey: string;
	dayOffset: number;
	labelDe: string;
	status: "fully_published" | "partly_published" | "estimated" | "unavailable";
	statusDe: string;
	confidencePct: number | null;
	minCtPerKwh: number | null;
	avgCtPerKwh: number | null;
	maxCtPerKwh: number | null;
	tendency: "guenstig" | "normal" | "teuer" | "unknown";
	reasonDe: string;
	hours: PriceOutlookHour[];
};

export type PriceOutlook = {
	schemaVersion: 1;
	generatedAtIso: string;
	timezone: string;
	status: "ready" | "degraded" | "unavailable" | "disabled";
	statusDe: string;
	informationalOnly: true;
	sources: {
		tibber: "available" | "missing";
		smard: "available" | "missing" | "stale";
		brightSky: "available" | "missing" | "stale";
	};
	spread: {
		expectedCtPerKwh: number | null;
		madCtPerKwh: number | null;
		sampleCount: number;
		confidencePct: number;
	};
	days: PriceOutlookDay[];
};

export type SmardPoint = { ts: number; ctPerKwh: number };

export type WeatherPoint = {
	ts: number;
	temperatureC: number | null;
	windKmh: number | null;
	/** Bright Sky: Globalstrahlung der vorherigen Stunde in kWh/m². */
	solarKwhM2: number | null;
	cloudPct: number | null;
};

export type RegionalWeather = {
	region: string;
	points: WeatherPoint[];
};
