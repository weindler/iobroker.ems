import { asNum } from "../../ems_light/state_util";
import { AI_ALLOWED_MODELS, type AiAllowedModel } from "../config";

export type AiAnalystMode = "disabled" | "manual" | "daily_auto";
export const AI_ANALYST_ALLOWED_MODES: AiAnalystMode[] = ["disabled", "manual", "daily_auto"];

export const AI_ANALYST_DEFAULT_MODEL: AiAllowedModel = "gpt-4.1-mini";
export const AI_ANALYST_TIMEOUT_MS = 30_000;
export const AI_ANALYST_DEFAULT_MAX_FINDINGS_RETAINED_DAYS = 120;

function isAllowedModel(v: unknown): v is AiAllowedModel {
	return typeof v === "string" && (AI_ALLOWED_MODELS as readonly string[]).includes(v);
}
function isAllowedMode(v: unknown): v is AiAnalystMode {
	return typeof v === "string" && (AI_ANALYST_ALLOWED_MODES as readonly string[]).includes(v);
}

export interface AiAnalystAdminConfig {
	/** disabled: nie aufrufen. manual: nur per Button. daily_auto: einmal/Tag automatisch nach Tagesabschluss. */
	mode: AiAnalystMode;
	model: AiAllowedModel;
	/** Reuse des bestehenden Providers/Tokens (`ai_openai_api_key`) — kein zweites Secret-Feld. */
	apiKey: string;
	retainedDays: number;
	/**
	 * PHASE 6: Findings mit numerischem Vorschlag dürfen den Validator passieren und als
	 * zeitlich begrenzter Planner-Override wirken. Standard aus — ohne Haken bleibt die KI
	 * rein analytisch.
	 */
	overrideEnabled: boolean;
}

/**
 * Der Daily Analyst nutzt bewusst denselben API-Token wie der Optimizer (ein OpenAI-Zugang pro
 * Adapter-Instanz) — separater Admin-Schalter `ai_analyst_mode` bestimmt aber unabhängig, ob/wie
 * er läuft. EMS-Betrieb bleibt unberührt, egal ob dieses Modul disabled/unavailable ist.
 */
export function aiAnalystConfigFromAdapter(config: unknown): AiAnalystAdminConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const mode = isAllowedMode(c.ai_analyst_mode) ? c.ai_analyst_mode : "disabled";
	const model = isAllowedModel(c.ai_analyst_model) ? c.ai_analyst_model : AI_ANALYST_DEFAULT_MODEL;
	const apiKeyRaw = c.ai_openai_api_key;
	const apiKey = typeof apiKeyRaw === "string" ? apiKeyRaw.trim() : "";
	const retainedRaw = asNum(c.ai_analyst_retained_days);
	const retainedDays =
		retainedRaw !== null && retainedRaw > 0 ? Math.round(retainedRaw) : AI_ANALYST_DEFAULT_MAX_FINDINGS_RETAINED_DAYS;
	const overrideEnabled = c.ai_override_enabled === true;
	return { mode, model, apiKey, retainedDays, overrideEnabled };
}
