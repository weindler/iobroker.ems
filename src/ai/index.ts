import { DAILY_PLAN_STATE_IDS } from "../operator/daily_plan/states";
import type { DailyPlan } from "../operator/daily_plan/types";
import { aiConfigFromAdapter } from "./config";
import { ensureAiStates } from "./ensure_states";
import { createOpenAiProvider } from "./openai_provider";
import { runAiOptimizationNow, type AiRunHost, type AiRunOutcome } from "./run";
import { aiTriggerDigestPayload } from "./trigger_digest";

export { ensureAiStates } from "./ensure_states";
export { AI_STATES } from "./ensure_states";
export { aiConfigFromAdapter, AI_ALLOWED_MODELS, AI_DEFAULT_MODEL, AI_DEFAULT_MAX_CALLS_PER_DAY } from "./config";
export { resolveAllowedAddonIds } from "./context";
export { aiTriggerDigestPayload } from "./trigger_digest";
export type { AiRunHost, AiRunOutcome } from "./run";

let lastTriggerDigestPayload = "";

export function resetAiPipelineHookForTest(): void {
	lastTriggerDigestPayload = "";
}

export async function ensureAiStateTree(host: Parameters<typeof ensureAiStates>[0]): Promise<void> {
	await ensureAiStates(host);
}

/**
 * Wird nach jedem Daily-Plan-Tick aufgerufen. Löst NICHT bei jeder Operator-Revision einen
 * KI-Versuch aus (die wechselt praktisch jeden Tick — Horizont-Roll, Allocation-Fortschritt,
 * Zehntelgrad-Zittern), sondern nur bei einer grob relevanten Änderung im Sinne von
 * `aiTriggerDigestPayload` (Add-on-Bedarf startet/endet, Zieltemperatur-Stufe wechselt,
 * PV-Tagesprognose springt deutlich, Tageswechsel, Global-Mode-Wechsel) — Kostenkontrolle,
 * Masterplan §13.
 */
export async function maybeTriggerAiOptimizationOnDailyPlanChange(
	host: AiRunHost,
	plan: DailyPlan,
): Promise<AiRunOutcome | null> {
	const cfg = aiConfigFromAdapter(host.config);
	const digestPayload = aiTriggerDigestPayload(plan);
	if (!cfg.enabled) {
		lastTriggerDigestPayload = digestPayload;
		return null;
	}
	if (digestPayload === lastTriggerDigestPayload) {
		return null;
	}
	lastTriggerDigestPayload = digestPayload;
	const provider = createOpenAiProvider();
	return runAiOptimizationNow(host, plan, "daily_plan_digest_change", provider);
}

const AI_OPTIMIZE_NOW_REQUEST_ID_SUFFIX = "ai.optimize_now_request";

/** Erlaubt das Auslösen von "Jetzt optimieren" auch direkt über den Objektbaum (analog Backup export_request). */
export function isAiRelatedState(relativeId: string): boolean {
	return relativeId === AI_OPTIMIZE_NOW_REQUEST_ID_SUFFIX;
}

export type AiStateChangeHost = AiRunHost & {
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	log?: { debug?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void };
};

export async function handleAiStateChange(
	host: AiStateChangeHost,
	relativeId: string,
	val: unknown,
	ack: boolean,
): Promise<boolean> {
	if (relativeId !== AI_OPTIMIZE_NOW_REQUEST_ID_SUFFIX || ack || val !== true) {
		return false;
	}
	await host.setStateAsync(AI_OPTIMIZE_NOW_REQUEST_ID_SUFFIX, { val: false, ack: true });
	try {
		await runAiOptimizationManual(host);
	} catch (e) {
		host.log?.error?.(`ai optimize_now_request: ${e instanceof Error ? e.message : String(e)}`);
	}
	return true;
}

/** Für den manuellen "Jetzt optimieren"-Button — liest den aktuellen Daily Plan direkt aus dem State. */
export async function runAiOptimizationManual(host: AiRunHost): Promise<AiRunOutcome> {
	const raw = await host.getStateAsync(DAILY_PLAN_STATE_IDS.planJson);
	let plan: DailyPlan | null = null;
	try {
		plan = typeof raw?.val === "string" ? (JSON.parse(raw.val) as DailyPlan) : null;
	} catch {
		plan = null;
	}
	if (!plan) {
		return { ran: false, status: "error", reasonDe: "Kein aktueller Daily Plan vorhanden." };
	}
	const provider = createOpenAiProvider();
	return runAiOptimizationNow(host, plan, "manual", provider);
}
