import {
	ADMIN_INTENT_DEFAULT_CHARGE_STRATEGY,
	ADMIN_INTENT_DEFAULT_TARGET_SOC_PCT,
	ADMIN_INTENT_EVCC_DEADLINE_STATE,
	ADMIN_INTENT_EVCC_IMMEDIATE_STATE,
	ADMIN_INTENT_EVCC_MODE_STATE,
	ADMIN_INTENT_EVCC_SOURCE_TIMESTAMP_STATE,
	ADMIN_INTENT_EVCC_TARGET_SOC_STATE,
	ADMIN_INTENT_MANUAL_OVERRIDE_MAX_MINUTES,
	ADMIN_INTENT_TIMEZONE,
	DEFAULT_TIMEZONE,
} from "./core/constants";
import type { WallboxChargeStrategy } from "./core/types";

function strField(config: Record<string, unknown>, key: string): string {
	const v = config[key];
	return typeof v === "string" ? v.trim() : "";
}

function numField(config: Record<string, unknown>, key: string): number | null {
	const v = config[key];
	if (v === null || v === undefined || v === "") return null;
	const n = typeof v === "number" ? v : parseFloat(String(v));
	return Number.isFinite(n) ? n : null;
}

export interface IntentEvccConfig {
	modeStateId: string;
	targetSocStateId: string;
	deadlineStateId: string;
	immediateStateId: string;
	sourceTimestampStateId: string;
}

export interface IntentAdminConfig {
	defaultChargeStrategy: WallboxChargeStrategy | null;
	defaultTargetSocPct: number | null;
	timezone: string;
	manualOverrideMaxMinutes: number | null;
}

export function intentEvccConfigFromAdapter(config: unknown): IntentEvccConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	return {
		modeStateId: strField(c, ADMIN_INTENT_EVCC_MODE_STATE),
		targetSocStateId: strField(c, ADMIN_INTENT_EVCC_TARGET_SOC_STATE),
		deadlineStateId: strField(c, ADMIN_INTENT_EVCC_DEADLINE_STATE),
		immediateStateId: strField(c, ADMIN_INTENT_EVCC_IMMEDIATE_STATE),
		sourceTimestampStateId: strField(c, ADMIN_INTENT_EVCC_SOURCE_TIMESTAMP_STATE),
	};
}

const VALID_STRATEGIES: WallboxChargeStrategy[] = ["off", "min_pv", "pv", "immediate"];

function parseChargeStrategy(raw: string): WallboxChargeStrategy | null {
	const s = raw.trim().toLowerCase();
	if (VALID_STRATEGIES.includes(s as WallboxChargeStrategy)) {
		return s as WallboxChargeStrategy;
	}
	return null;
}

export function intentAdminConfigFromAdapter(config: unknown): IntentAdminConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const tz = strField(c, ADMIN_INTENT_TIMEZONE) || DEFAULT_TIMEZONE;
	const stratRaw = strField(c, ADMIN_INTENT_DEFAULT_CHARGE_STRATEGY);
	const strat = stratRaw ? parseChargeStrategy(stratRaw) : null;
	const soc = numField(c, ADMIN_INTENT_DEFAULT_TARGET_SOC_PCT);
	const maxMin = numField(c, ADMIN_INTENT_MANUAL_OVERRIDE_MAX_MINUTES);
	return {
		defaultChargeStrategy: strat,
		defaultTargetSocPct: soc !== null && soc >= 0 && soc <= 100 ? soc : null,
		timezone: tz,
		manualOverrideMaxMinutes: maxMin !== null && maxMin > 0 ? maxMin : null,
	};
}

export function configuredEvccStateIds(cfg: IntentEvccConfig): string[] {
	const ids: string[] = [];
	if (cfg.modeStateId) ids.push(cfg.modeStateId);
	if (cfg.targetSocStateId) ids.push(cfg.targetSocStateId);
	if (cfg.deadlineStateId) ids.push(cfg.deadlineStateId);
	if (cfg.immediateStateId) ids.push(cfg.immediateStateId);
	if (cfg.sourceTimestampStateId) ids.push(cfg.sourceTimestampStateId);
	return ids;
}

/** Guard against accidental global mode key misuse */
export function isValidExternalStateId(id: string): boolean {
	return id.length > 0 && !id.startsWith("user_intent.") && !id.startsWith("policy.");
}
