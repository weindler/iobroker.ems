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
import { aiAnalystConfigFromAdapter, AI_ANALYST_TIMEOUT_MS } from "./config";
import { createOpenAiAnalystProvider, type AiAnalystProvider } from "./provider";
import { ingestAnalystFindingsAsOverrides } from "../override/ingest";
import { syncAiValidatorStates, type AiValidatorTickHost } from "../override/tick";
import { AI_ANALYST_FINDINGS_CATEGORY, pruneAiAnalystFindings, readAiAnalystDay, writeAiAnalystDay } from "./persist";
import { AI_ANALYST_STATES, ensureAiDailyAnalystStates } from "./ensure_states";
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
	await ensureAiDailyAnalystStates(host as unknown as StateHost);
	const cfg = aiAnalystConfigFromAdapter(host.config);
	await publish(host, AI_ANALYST_STATES.modeEffective, cfg.mode);

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
	const cfg = aiAnalystConfigFromAdapter(host.config);
	if (cfg.mode !== "daily_auto") return null;

	const timezone = timezoneFromConfig(host.config);
	const todayKey = localDateKeyInTimezone(now, timezone);
	const yesterdayKey = addDaysToDateKey(todayKey, -1);

	const already = await readAiAnalystDay(host.getAbsolutePath(AI_ANALYST_FINDINGS_CATEGORY), yesterdayKey);
	if (already) return null; // bereits verarbeitet (auch disabled/no_token/error zählt als "erledigt" für diesen Tag)

	return runDailyAnalystForDate(host, yesterdayKey, provider);
}

/** Für den manuellen Button: analysiert den zuletzt vom Daily Evaluator bewerteten Tag neu. */
export async function runDailyAnalystManual(
	host: AiDailyAnalystHost,
	now: Date = new Date(),
	provider?: AiAnalystProvider,
): Promise<AiAnalystRunResult> {
	const timezone = timezoneFromConfig(host.config);
	const todayKey = localDateKeyInTimezone(now, timezone);
	const yesterdayKey = addDaysToDateKey(todayKey, -1);
	return runDailyAnalystForDate(host, yesterdayKey, provider);
}
