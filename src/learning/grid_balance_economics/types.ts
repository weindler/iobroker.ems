import {
	GRID_BALANCE_ECONOMICS_MODULE,
	GRID_BALANCE_ECONOMICS_SCHEMA,
} from "./constants";

export type ChargeSource = "pv" | "grid" | "mixed" | "unknown";

export type ReplacePath = "pv_refill" | "grid_charge" | "later_avoided_import" | "surplus_export";

export type GridBalanceEconomicsDecision = "allow" | "block" | "fallback_min_price";

export type AlphaBetaPair = {
	alpha: number;
	beta: number;
	eGbKwh: number;
	source: "episode" | "slot";
};

export type AlphaBetaLearning = {
	usable: boolean;
	alpha: number | null;
	beta: number | null;
	confidence: number;
	pairCount: number;
	episodePairCount: number;
	slotPairCount: number;
	alphaIqr: number | null;
	betaIqr: number | null;
	reasonDe: string;
};

export type EtaPathLearning = {
	etaPvPath: number | null;
	etaGridPath: number | null;
	etaPvUsable: boolean;
	etaGridUsable: boolean;
	pvSessionCount: number;
	gridSessionCount: number;
	reasonDe: string;
};

export type ReplaceCostResult = {
	valueCtPerKwh: number | null;
	path: ReplacePath | null;
	reasonDe: string;
	confidence: number;
	usable: boolean;
};

export type EconomicsDecisionResult = {
	economicsUsable: boolean;
	economicsAllowed: boolean;
	decision: GridBalanceEconomicsDecision;
	alpha: number | null;
	beta: number | null;
	priceNowCt: number | null;
	cReplaceCtPerKwh: number | null;
	cReplacePath: ReplacePath | null;
	confidence: number;
	netBenefitCtPerKwh: number | null;
	reasonDe: string;
};

export type GridBalanceEconomicsPersist = {
	module: typeof GRID_BALANCE_ECONOMICS_MODULE;
	schemaVersion: typeof GRID_BALANCE_ECONOMICS_SCHEMA;
	generatedAt: string;
	alphaBeta: AlphaBetaLearning;
	eta: EtaPathLearning;
};

export function emptyAlphaBeta(reasonDe: string): AlphaBetaLearning {
	return {
		usable: false,
		alpha: null,
		beta: null,
		confidence: 0,
		pairCount: 0,
		episodePairCount: 0,
		slotPairCount: 0,
		alphaIqr: null,
		betaIqr: null,
		reasonDe,
	};
}

export function emptyEtaPath(reasonDe: string): EtaPathLearning {
	return {
		etaPvPath: null,
		etaGridPath: null,
		etaPvUsable: false,
		etaGridUsable: false,
		pvSessionCount: 0,
		gridSessionCount: 0,
		reasonDe,
	};
}

export function emptyEconomicsPersist(generatedAt: string, reasonDe: string): GridBalanceEconomicsPersist {
	return {
		module: GRID_BALANCE_ECONOMICS_MODULE,
		schemaVersion: GRID_BALANCE_ECONOMICS_SCHEMA,
		generatedAt,
		alphaBeta: emptyAlphaBeta(reasonDe),
		eta: emptyEtaPath(reasonDe),
	};
}
