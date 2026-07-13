import type { SnapshotStateValue } from "./types";

export type { SnapshotStateValue } from "./types";

export interface PlannerWeatherMetricRefs {
	actualStateId: string | null;
	forecastStateId: string | null;
}

export interface PlannerRelevantConfig {
	timezone: string;
	executionMode: string | null;
	batteryProfileId: string | null;
	batteryCapacityManualKwh: number | null;
	wallboxEvccEnabledStateId: string | null;
	priceForecastTodayStateId: string | null;
	priceForecastTomorrowStateId: string | null;
	immersion: {
		forecastModeEnabled: boolean;
		planningMaxTempC: number | null;
		minRuntimeMin: number | null;
		minPauseMin: number | null;
		stages: Array<{ index: number; enabled: boolean; nominalPowerW: number; label: string | null }>;
	};
	batteryWinter: SnapshotBatteryWinterConfigShape;
	acUnits: Array<{
		index: number;
		enabled: boolean;
		targetTempC: number | null;
	}>;
	weather: {
		temp: PlannerWeatherMetricRefs | null;
		cloud: PlannerWeatherMetricRefs | null;
	};
	adminPolicy: {
		gridImportAllowed: boolean;
		maxGridImportW: number | null;
		houseFuseLimitW: number | null;
		energyPriority: string[];
		mutualExclusions: Array<{ id: string; addonA: string; addonB: string; reason?: string }>;
	};
	dataPaths: {
		houseLoadLearningDir: string | null;
		thermalRuntimeLearningDir: string | null;
		consumerStatsDir: string | null;
	};
}

export interface SnapshotBatteryWinterConfigShape {
	enabled: boolean;
	horizonDays: number;
	socTargetMinPct: number | null;
	socTargetMaxPct: number | null;
}

/** Abstract data access for snapshot building — no ioBroker.Adapter. */
export interface PlannerSnapshotSource {
	readState(id: string): Promise<SnapshotStateValue>;
	readForeignState(id: string): Promise<SnapshotStateValue>;
	readJsonFile<T>(absolutePath: string): Promise<T | null>;
	readConfig(): Promise<PlannerRelevantConfig>;
	now(): Date;
}

export type ReadCounts = Map<string, number>;

/** Wraps a source and caches each state/foreign read exactly once. */
export class CachedPlannerSnapshotSource implements PlannerSnapshotSource {
	readonly readCounts: ReadCounts = new Map();
	private readonly stateCache = new Map<string, SnapshotStateValue>();
	private readonly foreignCache = new Map<string, SnapshotStateValue>();

	constructor(private readonly inner: PlannerSnapshotSource) {}

	private bump(key: string): void {
		this.readCounts.set(key, (this.readCounts.get(key) ?? 0) + 1);
	}

	async readState(id: string): Promise<SnapshotStateValue> {
		const key = `state:${id}`;
		this.bump(key);
		if (!this.stateCache.has(id)) {
			this.stateCache.set(id, await this.inner.readState(id));
		}
		return this.stateCache.get(id)!;
	}

	async readForeignState(id: string): Promise<SnapshotStateValue> {
		const key = `foreign:${id}`;
		this.bump(key);
		if (!this.foreignCache.has(id)) {
			this.foreignCache.set(id, await this.inner.readForeignState(id));
		}
		return this.foreignCache.get(id)!;
	}

	async readJsonFile<T>(absolutePath: string): Promise<T | null> {
		this.bump(`file:${absolutePath}`);
		return this.inner.readJsonFile<T>(absolutePath);
	}

	async readConfig(): Promise<PlannerRelevantConfig> {
		this.bump("config");
		return this.inner.readConfig();
	}

	now(): Date {
		return this.inner.now();
	}
}

export function numValue(st: SnapshotStateValue): number | null {
	const v = st.value;
	if (v === null || v === undefined) return null;
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string" && v.trim() !== "") {
		const n = parseFloat(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

export function strValue(st: SnapshotStateValue): string | null {
	const v = st.value;
	if (v === null || v === undefined) return null;
	const s = String(v).trim();
	return s === "" ? null : s;
}

export function boolValue(st: SnapshotStateValue): boolean | null {
	const v = st.value;
	if (v === true || v === false) return v;
	if (v === 1 || v === "1" || v === "true") return true;
	if (v === 0 || v === "0" || v === "false") return false;
	return null;
}

export function jsonStringValue(st: SnapshotStateValue): string | null {
	return strValue(st);
}
