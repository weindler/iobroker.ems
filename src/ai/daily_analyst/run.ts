/**
 * PHASE 4 — Orchestrierung des KI Daily Analyst.
 *
 * Läuft als expliziter Tagesprozess (einmal/Tag im `daily_auto`-Modus, nachdem der Daily
 * Evaluator einen Tag abgeschlossen hat) oder manuell per Button. NIE im schnellen EMS-Tick,
 * NIE minütlich. Ohne Token/Provider/Konfiguration bleibt das EMS unverändert funktionsfähig —
 * dieses Modul liefert dann nur `status:"disabled"`/`"no_token"`, wirft nie.
 */

import { addDaysToDateKey, localDateKeyInTimezone } from "../../operator/time";
import { DAILY_EVALUATOR_FINDINGS_CATEGORY, DAILY_EVALUATOR_SCORES_CATEGORY } from "../../learning/daily_evaluator/constants";
import { readFindingsDay, readScoresDay } from "../../learning/daily_evaluator/persist";
import { ECONOMICS_PERSIST_CATEGORY, readEconomicsPersist } from "../../economics/persist";
import { SHADOW_ENGINE_RESULTS_CATEGORY } from "../../learning/shadow_engine/constants";
import { readShadowDayRecord } from "../../learning/shadow_engine/persist";
import { buildAiAnalystContext } from "./context";
import { AI_ANALYST_TIMEOUT_MS } from "./config";
import { createOpenAiAnalystProvider, type AiAnalystProvider } from "./provider";
import { ingestAnalystFindingsAsOverrides } from "../override/ingest";
import { syncAiValidatorStates, type AiValidatorTickHost } from "../override/tick";
import { AI_ANALYST_FINDINGS_CATEGORY, pruneAiAnalystFindings, readAiAnalystDay, writeAiAnalystDay } from "./persist";
import { AI_ANALYST_STATES, syncAiDailyAnalystRuntimeFromConfig } from "./ensure_states";
import type { StateHost } from "../../ems_light/state_util";
import type { AiAnalystRunResult } from "./types";

export type AiDailyAnalystHost = {
	getAbsolutePath: (category?: string) => string;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	config?: unknown;
	log?: { warn?: (m: string) => void; debug?: (m: string) => void; error?: (m: string) => void };
};

async function publish(host: AiDailyAnalystHost, id: string, val: ioBroker.StateValue): Promise<void> {
	try {
		await host.setStateAsync(id, { val, ack: true });
	} catch {
		/* Status-States sind best-effort */
	}
}

function timezoneFromConfig(config: unknown): string {
	const tz =
		typeof (config as Record<string, unknown>)?.timezone === "string"
			? ((config as Record<string, unknown>).timezone as string).trim()
			: "";
	return tz || "Europe/Berlin";
}

/**
 * Führt den Analysten für genau einen bereits vom Daily Evaluator abgeschlossenen Tag aus.
 * Persistiert das Ergebnis (auch `disabled`/`no_token`/Fehler — damit ist der Tag "erledigt"
 * und wird nicht endlos wiederholt) und aktualisiert die Status-States.
 */
export async function runDailyAnalystForDate(
	host: AiDailyAnalystHost,
	dateKey: string,
	provider: AiAnalystProvider = createOpenAiAnalystProvider(),
): Promise<AiAnalystRunResult> {
	const cfg = await syncAiDailyAnalystRuntimeFromConfig(host as unknown as StateHost & { config?: unknown });

	const result = async (): Promise<AiAnalystRunResult> => {
		if (cfg.mode === "disabled") {
			return {
				ran: false,
				status: "disabled",
				dateKey,
				findings: [],
				reasonDe: "KI Daily Analyst im Admin deaktiviert (ai_analyst_mode=disabled).",
				usage: { promptTokens: null, completionTokens: null },
			};
		}
		if (!cfg.apiKey) {
			return {
				ran: false,
				status: "no_token",
				dateKey,
				findings: [],
				reasonDe: "Kein OpenAI-API-Token konfiguriert (ai_openai_api_key) — KI Daily Analyst bleibt unavailable.",
				usage: { promptTokens: null, completionTokens: null },
			};
		}

		const scoresDir = host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY);
		const findingsDir = host.getAbsolutePath(DAILY_EVALUATOR_FINDINGS_CATEGORY);
		const record = await readScoresDay(scoresDir, dateKey);
		if (!record) {
			return {
				ran: false,
				status: "no_data",
				dateKey,
				findings: [],
				reasonDe: `Daily Evaluator hat ${dateKey} noch nicht bewertet — KI Daily Analyst wartet.`,
				usage: { promptTokens: null, completionTokens: null },
			};
		}
		const findings = (await readFindingsDay(findingsDir, dateKey)) ?? [];

		const econPersist = await readEconomicsPersist(host.getAbsolutePath(ECONOMICS_PERSIST_CATEGORY));
		const economics = econPersist.days[dateKey] ?? null;
		const shadow = await readShadowDayRecord(host.getAbsolutePath(SHADOW_ENGINE_RESULTS_CATEGORY), dateKey);

		const context = buildAiAnalystContext({ dateKey, record, findings, economics, shadow });
		await publish(host, AI_ANALYST_STATES.status, "running");
		const providerResult = await provider.analyze(context, {
			apiKey: cfg.apiKey,
			model: cfg.model,
			timeoutMs: AI_ANALYST_TIMEOUT_MS,
		});

		if (!providerResult.ok) {
			const status: AiAnalystRunResult["status"] =
				providerResult.error === "invalid_json" || providerResult.error?.startsWith("invalid_structure")
					? "invalid_response"
					: "error";
			return {
				ran: true,
				status,
				dateKey,
				findings: [],
				reasonDe: providerResult.reasonDe,
				usage: providerResult.usage,
				error: providerResult.error,
			};
		}
		return {
			ran: true,
			status: "ok",
			dateKey,
			findings: providerResult.findings,
			reasonDe: providerResult.reasonDe,
			usage: providerResult.usage,
		};
	};

	const outcome = await result();

	try {
		await writeAiAnalystDay(host.getAbsolutePath(AI_ANALYST_FINDINGS_CATEGORY), dateKey, {
			status: outcome.status,
			reasonDe: outcome.reasonDe,
			model: cfg.model,
			findings: outcome.findings,
		});
		const todayKey = localDateKeyInTimezone(new Date(), timezoneFromConfig(host.config));
		await pruneAiAnalystFindings(host.getAbsolutePath(AI_ANALYST_FINDINGS_CATEGORY), cfg.retainedDays, todayKey);
	} catch (e) {
		host.log?.warn?.(`ai_daily_analyst persist: ${e instanceof Error ? e.message : String(e)}`);
	}

	await publish(host, AI_ANALYST_STATES.enabled, cfg.mode !== "disabled");
	await publish(host, AI_ANALYST_STATES.status, outcome.status);
	await publish(host, AI_ANALYST_STATES.lastRunAtIso, new Date().toISOString());
	await publish(host, AI_ANALYST_STATES.lastRunDateKey, dateKey);
	await publish(host, AI_ANALYST_STATES.reasonDe, outcome.reasonDe);
	await publish(host, AI_ANALYST_STATES.lastError, outcome.error ?? "");
	await publish(host, AI_ANALYST_STATES.findingsCount, outcome.findings.length);
	const top = [...outcome.findings].sort((a, b) => b.confidencePct - a.confidencePct)[0];
	await publish(
		host,
		AI_ANALYST_STATES.topFindingDe,
		top ? `${top.observedBehaviorDe} → ${top.suggestedImprovementDe}` : "",
	);

	if (outcome.status === "ok" && cfg.overrideEnabled && outcome.findings.length > 0 && dateKey) {
		try {
			await ingestAnalystFindingsAsOverrides(host, outcome.findings, dateKey);
			await syncAiValidatorStates(host as unknown as AiValidatorTickHost);
		} catch (e) {
			host.log?.warn?.(`ai_daily_analyst override ingest: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	return outcome;
}

/**
 * `daily_auto`-Modus: einmal pro Kalendertag, für den zuletzt vollständig abgeschlossenen
 * Tag ("gestern"), sobald der Daily Evaluator ihn bewertet hat. Idempotent über
 * `lastRunDateKey` — kein zweiter KI-Aufruf für denselben Tag.
 */
export async function maybeRunDailyAnalystAutomatically(
	host: AiDailyAnalystHost,
	now: Date = new Date(),
	provider?: AiAnalystProvider,
): Promise<AiAnalystRunResult | null> {
	const cfg = await syncAiDailyAnalystRuntimeFromConfig(host as unknown as StateHost & { config?: unknown });
	if (cfg.mode !== "daily_auto") return null;

	const timezone = timezoneFromConfig(host.config);
	const todayKey = localDateKeyInTimezone(now, timezone);
	const yesterdayKey = addDaysToDateKey(todayKey, -1);

	const already = await readAiAnalystDay(host.getAbsolutePath(AI_ANALYST_FINDINGS_CATEGORY), yesterdayKey);
	if (already) return null; // bereits verarbeitet (auch disabled/no_token/error zählt als "erledigt" für diesen Tag)

	return runDailyAnalystForDate(host, yesterdayKey, provider);
}

function emptyManualResult(
	status: AiAnalystRunResult["status"],
	reasonDe: string,
	dateKey: string | null = null,
): AiAnalystRunResult {
	return {
		ran: false,
		status,
		dateKey,
		findings: [],
		reasonDe,
		usage: { promptTokens: null, completionTokens: null },
	};
}

/**
 * Kurztext für den Admin-sendTo-Dialog — kein JSON-Dump, nur der effektive Ausgang.
 */
export function formatAiDailyAnalystAdminHint(outcome: AiAnalystRunResult): string {
	switch (outcome.status) {
		case "disabled":
			return "Daily Analyst ist deaktiviert";
		case "no_token":
			return "no_token";
		case "no_data":
			return "kein evaluierter Tag verfügbar";
		case "ok":
			return "abgeschlossen";
		case "error":
		case "invalid_response":
			return outcome.error ? `Fehler: ${outcome.error}` : "Fehler";
		default:
			return outcome.reasonDe || outcome.status;
	}
}

export type AiDailyAnalystAdminButtonResult = {
	result: "ok" | "error";
	status: string;
	hint: string;
	text: string;
};

/**
 * Admin-„Jetzt analysieren“: setzt denselben Runtime-Trigger wie der Objektbaum
 * (`ai.daily_analyst.run_now_request`) und führt denselben Manual-Pfad aus.
 * Overrides werden dadurch nicht eingeschaltet.
 */
export async function runDailyAnalystFromAdminButton(
	host: AiDailyAnalystHost,
	now: Date = new Date(),
	provider?: AiAnalystProvider,
): Promise<AiDailyAnalystAdminButtonResult> {
	const cfg = await syncAiDailyAnalystRuntimeFromConfig(host as unknown as StateHost & { config?: unknown });
	if (cfg.mode === "disabled") {
		const hint = formatAiDailyAnalystAdminHint(
			emptyManualResult("disabled", "Daily Analyst ist deaktiviert"),
		);
		return { result: "error", status: "disabled", hint, text: hint };
	}
	try {
		// ack:true — kein zweites onStateChange; der Trigger bleibt im Objektbaum sichtbar.
		await host.setStateAsync(AI_ANALYST_STATES.runNowRequest, { val: true, ack: true });
	} catch {
		/* Trigger-State ist best-effort; der Lauf folgt trotzdem über denselben Manual-Pfad. */
	}
	const outcome = await handleDailyAnalystRunNowRequest(host, now, provider);
	const hint = formatAiDailyAnalystAdminHint(outcome);
	const result: "ok" | "error" =
		outcome.status === "disabled" || outcome.status === "error" || outcome.status === "invalid_response"
			? "error"
			: "ok";
	return { result, status: outcome.status, hint, text: hint };
}

/** Gemeinsamer Handler für Objektbaum-Button und Admin-sendTo. */
export async function handleDailyAnalystRunNowRequest(
	host: AiDailyAnalystHost,
	now: Date = new Date(),
	provider?: AiAnalystProvider,
): Promise<AiAnalystRunResult> {
	try {
		await host.setStateAsync(AI_ANALYST_STATES.runNowRequest, { val: false, ack: true });
	} catch {
		/* Reset ist best-effort */
	}
	return runDailyAnalystManual(host, now, provider);
}

/**
 * Für den manuellen Button: analysiert den zuletzt vom Daily Evaluator bewerteten Tag.
 * `manual`: immer (erneut). `daily_auto`: nur wenn der Tag noch nicht persistiert ist
 * (bestehende Auto-Deduplizierung). `disabled`: kein Lauf.
 */
export async function runDailyAnalystManual(
	host: AiDailyAnalystHost,
	now: Date = new Date(),
	provider?: AiAnalystProvider,
): Promise<AiAnalystRunResult> {
	const cfg = await syncAiDailyAnalystRuntimeFromConfig(host as unknown as StateHost & { config?: unknown });
	if (cfg.mode === "disabled") {
		return emptyManualResult("disabled", "Daily Analyst ist deaktiviert");
	}

	const timezone = timezoneFromConfig(host.config);
	const todayKey = localDateKeyInTimezone(now, timezone);
	const yesterdayKey = addDaysToDateKey(todayKey, -1);

	if (cfg.mode === "daily_auto") {
		const already = await readAiAnalystDay(host.getAbsolutePath(AI_ANALYST_FINDINGS_CATEGORY), yesterdayKey);
		if (already) {
			await publish(host, AI_ANALYST_STATES.status, already.status);
			await publish(host, AI_ANALYST_STATES.reasonDe, already.reasonDe);
			await publish(host, AI_ANALYST_STATES.findingsCount, already.findings.length);
			const top = [...already.findings].sort((a, b) => b.confidencePct - a.confidencePct)[0];
			await publish(
				host,
				AI_ANALYST_STATES.topFindingDe,
				top ? `${top.observedBehaviorDe} → ${top.suggestedImprovementDe}` : "",
			);
			return {
				ran: false,
				status: already.status,
				dateKey: yesterdayKey,
				findings: already.findings,
				reasonDe: already.reasonDe || "bereits analysiert (1×/Tag)",
				usage: { promptTokens: null, completionTokens: null },
			};
		}
	}

	return runDailyAnalystForDate(host, yesterdayKey, provider);
}
