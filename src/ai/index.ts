import { DAILY_PLAN_STATE_IDS } from "../operator/daily_plan/states";
import type { DailyPlan } from "../operator/daily_plan/types";
import { asNum } from "../ems_light/state_util";
import { aiConfigFromAdapter } from "./config";
import { AI_STATES, ensureAiStates } from "./ensure_states";
import { createOpenAiProvider } from "./openai_provider";
import { runAiOptimizationNow, type AiRunHost, type AiRunOutcome } from "./run";
import { aiTriggerDigestPayload } from "./trigger_digest";
import { isAiAutoSuspended } from "./writeback";

export { ensureAiStates } from "./ensure_states";
export { AI_STATES } from "./ensure_states";
export {
	aiConfigFromAdapter,
	AI_ALLOWED_MODELS,
	AI_DEFAULT_MODEL,
	AI_DEFAULT_MAX_CALLS_PER_DAY,
	AI_DEFAULT_MIN_INTERVAL_MINUTES,
} from "./config";
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
 * PV-Tagesprognose springt deutlich, Tageswechsel, Global-Mode-Wechsel) — nicht bei
 * Allocation-Fortschritt Slot für Slot (v0.1.194) und nicht bei wiederholtem Bedarf pro Slot
 * in den Totals (v0.1.195) — Kostenkontrolle, Masterplan §13.
 *
 * Seit v0.1.196: zusätzlich ein konfigurierbarer Mindestabstand zwischen automatischen Aufrufen
 * (Default 60 Min, Admin-Feld "ai_min_interval_minutes", 0 = deaktiviert). Der Digest allein hat
 * sich live als zu fein erwiesen (z. B. Heizstab-Zieltemperatur, die in kleinen Schritten über
 * mehrere Bucket-Grenzen wandert) — der Mindestabstand deckelt automatische Aufrufe hart auf
 * max. 24/Tag bei stündlichem Abstand, unabhängig davon, wie oft sich der Digest ändert. Der
 * Zeitpunkt des letzten automatischen Triggers wird persistiert (`AI_STATES.lastAutoTriggerAtMs`),
 * damit ein Adapter-Neustart das Limit nicht aushebelt. Der manuelle "Jetzt optimieren"-Button
 * ignoriert Digest und Mindestabstand vollständig (unverändert).
 */
export async function maybeTriggerAiOptimizationOnDailyPlanChange(
	host: AiRunHost,
	plan: DailyPlan,
	now: Date = new Date(),
): Promise<AiRunOutcome | null> {
	const cfg = aiConfigFromAdapter(host.config);
	const digestPayload = aiTriggerDigestPayload(plan);
	if (!cfg.enabled) {
		lastTriggerDigestPayload = digestPayload;
		return null;
	}
	if (await isAiAutoSuspended(host)) {
		return null;
	}
	if (digestPayload === lastTriggerDigestPayload) {
		return null;
	}
	if (cfg.minIntervalMinutes > 0) {
		const lastTriggerMs = asNum((await host.getStateAsync(AI_STATES.lastAutoTriggerAtMs))?.val) ?? 0;
		const elapsedMs = now.getTime() - lastTriggerMs;
		if (lastTriggerMs > 0 && elapsedMs < cfg.minIntervalMinutes * 60_000) {
			// Digest bleibt bewusst ungesetzt, damit der nächste Tick nach Ablauf des
			// Mindestabstands mit dem dann aktuellen Plan sofort feuert.
			return null;
		}
	}
	lastTriggerDigestPayload = digestPayload;
	await host.setStateAsync(AI_STATES.lastAutoTriggerAtMs, { val: now.getTime(), ack: true });
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
