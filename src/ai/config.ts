import { asBool, asNum } from "../ems_light/state_util";
import type { AiProviderId } from "./types";

/** Whitelist statt Freitext — verhindert Tippfehler/nicht existente Modelle im Admin. */
export const AI_ALLOWED_MODELS = ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt-5-mini"] as const;
export type AiAllowedModel = (typeof AI_ALLOWED_MODELS)[number];

export const AI_DEFAULT_MODEL: AiAllowedModel = "gpt-4.1-mini";
export const AI_DEFAULT_MAX_CALLS_PER_DAY = 20;
/** Mindestabstand zwischen automatischen KI-Aufrufen (Minuten) — 0 = kein Mindestabstand (nur Digest zählt). */
export const AI_DEFAULT_MIN_INTERVAL_MINUTES = 60;
/** 0 = kein Monatslimit (nur Tagesaufrufe). */
export const AI_DEFAULT_MONTHLY_COST_LIMIT_EUR = 0;
export const AI_SOFT_WARNING_FRACTION = 0.8;
/** Legacy-Pfad (slot_preferences only). */
export const AI_DEFAULT_TIMEOUT_MS = 20_000;
/** Denkende KI — längerer Timeout für Situation+Horizont. */
export const AI_THINKING_TIMEOUT_MS = 45_000;

function isAllowedModel(v: unknown): v is AiAllowedModel {
	return typeof v === "string" && (AI_ALLOWED_MODELS as readonly string[]).includes(v);
}

export interface AiAdminConfig {
	/**
	 * @deprecated Legacy-Native `ai_enabled` — nur noch Bootstrap/Migration.
	 * Laufende Enable-Wahrheit: `ai.user_enabled` (siehe `readAiUserEnabled`).
	 */
	enabled: boolean;
	provider: AiProviderId;
	model: AiAllowedModel;
	/** "" wenn kein Token gesetzt — niemals erfunden. */
	apiKey: string;
	maxCallsPerDay: number;
	/**
	 * Mindestabstand zwischen automatischen (nicht manuellen) KI-Aufrufen, in Minuten. 0 = deaktiviert.
	 * Entspricht Masterplan `minimum_replan_interval` (Admin-Key: `ai_min_interval_minutes`).
	 */
	minIntervalMinutes: number;
	/** Monatliches Kosten-Softlimit in EUR; 0 = aus. Admin-Key: `ai_monthly_cost_limit_eur`. */
	monthlyCostLimitEur: number;
	/**
	 * Denkmodus: Situation+Horizont, Entscheidungen über Add-ons; false = Legacy nur slot_preferences.
	 * Default true. Admin-Key: `ai_thinking_mode`.
	 */
	thinkingMode: boolean;
}

export function aiConfigFromAdapter(config: unknown): AiAdminConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};

	/** Legacy native — nicht für Runtime-Gates verwenden. */
	const enabled = asBool(c.ai_enabled) ?? false;
	const model = isAllowedModel(c.ai_model) ? c.ai_model : AI_DEFAULT_MODEL;
	const apiKeyRaw = c.ai_openai_api_key;
	const apiKey = typeof apiKeyRaw === "string" ? apiKeyRaw.trim() : "";
	const maxCallsRaw = asNum(c.ai_max_calls_per_day);
	const maxCallsPerDay =
		maxCallsRaw !== null && maxCallsRaw > 0 ? Math.round(maxCallsRaw) : AI_DEFAULT_MAX_CALLS_PER_DAY;

	const minIntervalRaw = asNum(c.ai_min_interval_minutes);
	// 0 ist ein gültiger, bewusster Wert (Mindestabstand deaktiviert) — nur negativ/ungültig fällt auf Default zurück.
	const minIntervalMinutes =
		minIntervalRaw !== null && minIntervalRaw >= 0
			? Math.round(minIntervalRaw)
			: AI_DEFAULT_MIN_INTERVAL_MINUTES;

	const monthlyRaw = asNum(c.ai_monthly_cost_limit_eur);
	const monthlyCostLimitEur =
		monthlyRaw !== null && monthlyRaw >= 0 ? monthlyRaw : AI_DEFAULT_MONTHLY_COST_LIMIT_EUR;

	const thinkingMode = asBool(c.ai_thinking_mode) ?? true;

	return {
		enabled,
		provider: "openai",
		model,
		apiKey,
		maxCallsPerDay,
		minIntervalMinutes,
		monthlyCostLimitEur,
		thinkingMode,
	};
}
