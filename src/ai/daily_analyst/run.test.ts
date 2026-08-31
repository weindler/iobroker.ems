import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	formatAiDailyAnalystAdminHint,
	maybeRunDailyAnalystAutomatically,
	runDailyAnalystForDate,
	runDailyAnalystFromAdminButton,
	runDailyAnalystManual,
	asDailyAnalystAdapterHost,
	type AiDailyAnalystHost,
} from "./run";
import { AI_ANALYST_STATES, ensureAiDailyAnalystStates, syncAiDailyAnalystRuntimeFromConfig } from "./ensure_states";
import { DAILY_EVALUATOR_SCORES_CATEGORY } from "../../learning/daily_evaluator/constants";
import { writeScoresDay } from "../../learning/daily_evaluator/persist";
import type { EvaluationRecord } from "../../learning/daily_evaluator/types";
import type { AiAnalystProvider } from "./provider";
import type { AiAnalystFinding } from "./types";
import { AI_OVERRIDE_LEDGER_CATEGORY, readOverrideLedgerStore } from "../override/persist";
import { AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT } from "../override/allowlist";
import type { StateHost } from "../../ems_light/state_util";
import { AI_STATES } from "../ensure_states";
import { estimateCostEur } from "../pricing";
import { recordDailyCall } from "../limiter";
import { AI_ANALYST_FINDINGS_CATEGORY, readAiAnalystDay } from "./persist";

const NOW = new Date("2026-08-31T10:00:00+02:00");
const YESTERDAY = "2026-08-30";

function silentProvider(): AiAnalystProvider {
	return {
		analyze: async () => {
			throw new Error("Provider darf bei disabled/no_token nicht aufgerufen werden");
		},
	};
}

function countingProvider(
	findings: AiAnalystFinding[] = [],
	usage: { promptTokens: number | null; completionTokens: number | null } = {
		promptTokens: 8_000,
		completionTokens: 400,
	},
): { provider: AiAnalystProvider; calls: { n: number } } {
	const calls = { n: 0 };
	return {
		calls,
		provider: {
			analyze: async () => {
				calls.n += 1;
				return {
					ok: true,
					findings,
					reasonDe: "Analyse ok.",
					usage,
				};
			},
		},
	};
}

function numericFinding(): AiAnalystFinding {
	return {
		findingType: "grid_balance_too_shy",
		domain: "battery",
		severity: "notice",
		confidencePct: 80,
		evidence: ["SOC 91 %."],
		observedBehaviorDe: "Netzausgleich blieb zu.",
		suggestedImprovementDe: "Opportunity-Marge leicht senken.",
		affectedParameter: AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT,
		proposedNumericValue: 2,
		expectedDirection: "cost_down",
		uncertaintyDe: "Nur ein Tag.",
		dateKey: YESTERDAY,
	};
}

function scoresRecord(dateKey: string): EvaluationRecord {
	return {
		evaluatorSchemaVersion: 1,
		sourceTelemetrySchemaVersion: 1,
		sourceUpdatedAtIso: `${dateKey}T23:00:00.000Z`,
		dateKey,
		timezone: "Europe/Berlin",
		evaluatedAtIso: `${dateKey}T23:30:00.000Z`,
		dayComplete: true,
		dayEvaluable: true,
		dayCoveragePct: 100,
		eligibility: [],
		findingsCount: 0,
		findingsByDomain: { battery: 0, thermal: 0, climate: 0, ev: 0 },
		scores: [],
		globalScore: null,
		globalScoreWeights: {},
	};
}

type TestHost = AiDailyAnalystHost & StateHost & {
	states: Map<string, ioBroker.StateValue>;
	writes: Array<{ id: string; val: ioBroker.StateValue; ack?: boolean }>;
};

function makeHost(config: Record<string, unknown>, dir: string): TestHost {
	const states = new Map<string, ioBroker.StateValue>();
	const writes: TestHost["writes"] = [];
	const host: TestHost = {
		states,
		writes,
		config,
		getAbsolutePath: (category?: string) => (category ? path.join(dir, ...category.split("/")) : dir),
		getStateAsync: async (id) => {
			if (!states.has(id)) return null;
			return { val: states.get(id) } as ioBroker.State;
		},
		setStateAsync: async (id, state) => {
			const s = state as ioBroker.SettableState;
			writes.push({ id, val: s.val as ioBroker.StateValue, ack: s.ack });
			states.set(id, s.val as ioBroker.StateValue);
		},
		setObjectNotExistsAsync: async () => undefined,
		log: { warn: () => undefined, debug: () => undefined, error: () => undefined },
	};
	return host;
}

describe("runDailyAnalystForDate — EMS läuft ohne KI weiter", () => {
	it("status=disabled ohne Provider-Aufruf, wenn Admin-Modus disabled", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
		const r = await runDailyAnalystForDate(
			makeHost({ ai_analyst_mode: "disabled", ai_openai_api_key: "sk-test" }, dir),
			YESTERDAY,
			silentProvider(),
		);
		assert.equal(r.status, "disabled");
		assert.equal(r.ran, false);
		assert.equal(r.findings.length, 0);
	});

	it("status=no_token ohne Provider-Aufruf, wenn kein API-Key gesetzt ist", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
		const r = await runDailyAnalystForDate(
			makeHost({ ai_analyst_mode: "manual", ai_openai_api_key: "" }, dir),
			YESTERDAY,
			silentProvider(),
		);
		assert.equal(r.status, "no_token");
		assert.equal(r.ran, false);
		assert.equal(r.findings.length, 0);
	});
});

describe("Admin-Config → Runtime-States", () => {
	it("disabled Admin → enabled=false, mode_effective=disabled, status=disabled", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
		const host = makeHost({ ai_analyst_mode: "disabled" }, dir);
		await syncAiDailyAnalystRuntimeFromConfig(host);
		assert.equal(host.states.get(AI_ANALYST_STATES.enabled), false);
		assert.equal(host.states.get(AI_ANALYST_STATES.modeEffective), "disabled");
		assert.equal(host.states.get(AI_ANALYST_STATES.status), "disabled");
	});

	it("manual Admin → enabled=true, mode_effective=manual", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
		const host = makeHost({ ai_analyst_mode: "manual" }, dir);
		await syncAiDailyAnalystRuntimeFromConfig(host);
		assert.equal(host.states.get(AI_ANALYST_STATES.enabled), true);
		assert.equal(host.states.get(AI_ANALYST_STATES.modeEffective), "manual");
		assert.equal(host.states.get(AI_ANALYST_STATES.status), "idle");
	});

	it("daily_auto Admin → enabled=true, mode_effective=daily_auto", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
		const host = makeHost({ ai_analyst_mode: "daily_auto" }, dir);
		await syncAiDailyAnalystRuntimeFromConfig(host);
		assert.equal(host.states.get(AI_ANALYST_STATES.enabled), true);
		assert.equal(host.states.get(AI_ANALYST_STATES.modeEffective), "daily_auto");
		assert.equal(host.states.get(AI_ANALYST_STATES.status), "idle");
	});

	it("Persistenz nach Adapter-Neustart: Ensure-Defaults überschreiben manual nicht, Sync stellt den Modus wieder her", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
		const host = makeHost({ ai_analyst_mode: "disabled" }, dir);
		await ensureAiDailyAnalystStates(host);
		assert.equal(host.states.get(AI_ANALYST_STATES.modeEffective), "disabled");
		assert.equal(host.states.get(AI_ANALYST_STATES.enabled), false);

		host.config = { ai_analyst_mode: "manual" };
		await ensureAiDailyAnalystStates(host);
		assert.equal(
			host.states.get(AI_ANALYST_STATES.modeEffective),
			"disabled",
			"Ensure darf vorhandene Werte nicht mit disabled überschreiben",
		);

		await syncAiDailyAnalystRuntimeFromConfig(host);
		assert.equal(host.states.get(AI_ANALYST_STATES.modeEffective), "manual");
		assert.equal(host.states.get(AI_ANALYST_STATES.enabled), true);

		await ensureAiDailyAnalystStates(host);
		await syncAiDailyAnalystRuntimeFromConfig(host);
		assert.equal(host.states.get(AI_ANALYST_STATES.modeEffective), "manual");
		assert.equal(host.states.get(AI_ANALYST_STATES.enabled), true);
		assert.notEqual(host.states.get(AI_ANALYST_STATES.status), "disabled");
	});
});

describe("Jetzt analysieren / run_now_request", () => {
	it("disabled verhindert den Lauf und erklärt ihn", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
		const host = makeHost({ ai_analyst_mode: "disabled", ai_openai_api_key: "sk-test" }, dir);
		const admin = await runDailyAnalystFromAdminButton(host, NOW, silentProvider());
		assert.equal(admin.result, "error");
		assert.equal(admin.status, "disabled");
		assert.equal(admin.hint, "Daily Analyst ist deaktiviert");
		assert.equal(
			host.writes.some((w) => w.id === AI_ANALYST_STATES.runNowRequest && w.val === true),
			false,
		);
		const manual = await runDailyAnalystManual(host, NOW, silentProvider());
		assert.equal(manual.ran, false);
		assert.equal(manual.status, "disabled");
	});

	it("Button triggert run_now_request und startet im Modus manual", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
		const host = makeHost({ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test" }, dir);
		const admin = await runDailyAnalystFromAdminButton(host, NOW, silentProvider());
		assert.equal(
			host.writes.some((w) => w.id === AI_ANALYST_STATES.runNowRequest && w.val === true),
			true,
		);
		assert.equal(host.states.get(AI_ANALYST_STATES.runNowRequest), false);
		assert.equal(admin.status, "no_data");
		assert.equal(admin.hint, "kein evaluierter Tag verfügbar");
	});

	it("kein Token → sauber no_token", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
		const host = makeHost({ ai_analyst_mode: "manual" }, dir);
		const admin = await runDailyAnalystFromAdminButton(host, NOW, silentProvider());
		assert.equal(admin.status, "no_token");
		assert.equal(admin.hint, "no_token");
		assert.equal(host.states.get(AI_ANALYST_STATES.status), "no_token");
		assert.equal(host.states.get(AI_ANALYST_STATES.modeEffective), "manual");
		assert.equal(host.states.get(AI_ANALYST_STATES.enabled), true);
	});

	it("manual startet einen Lauf, sobald ein evaluierter Tag da ist", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
		const host = makeHost(
			{ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test", timezone: "Europe/Berlin" },
			dir,
		);
		await writeScoresDay(host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord(YESTERDAY));
		const counted = countingProvider();
		const r = await runDailyAnalystManual(host, NOW, counted.provider);
		assert.equal(counted.calls.n, 1);
		assert.equal(r.ran, true);
		assert.equal(r.status, "ok");
	});

	it("daily_auto: erster Lauf ja, zweiter Zusatzlauf durch Deduplizierung übersprungen", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
		const host = makeHost(
			{ ai_analyst_mode: "daily_auto", ai_openai_api_key: "sk-test", timezone: "Europe/Berlin" },
			dir,
		);
		await writeScoresDay(host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord(YESTERDAY));
		const counted = countingProvider();
		const first = await runDailyAnalystFromAdminButton(host, NOW, counted.provider);
		assert.equal(first.status, "ok");
		assert.equal(counted.calls.n, 1);

		const second = await runDailyAnalystFromAdminButton(host, NOW, counted.provider);
		assert.equal(counted.calls.n, 1);
		assert.equal(second.status, "ok");
		assert.equal(second.hint, "abgeschlossen");

		const auto = await maybeRunDailyAnalystAutomatically(host, NOW, silentProvider());
		assert.equal(auto, null);
	});

	it("manueller Lauf ohne Override-Haken schreibt keine Planner-Overrides", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
		const host = makeHost(
			{
				ai_analyst_mode: "manual",
				ai_openai_api_key: "sk-test",
				ai_override_enabled: false,
				timezone: "Europe/Berlin",
			},
			dir,
		);
		await writeScoresDay(host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord(YESTERDAY));
		const counted = countingProvider([numericFinding()]);
		const r = await runDailyAnalystManual(host, NOW, counted.provider);
		assert.equal(r.status, "ok");
		assert.equal(r.findings.length, 1);
		const ledger = await readOverrideLedgerStore(host.getAbsolutePath(AI_OVERRIDE_LEDGER_CATEGORY));
		assert.equal(ledger.overrides.length, 0);
	});

	it("sendTo-Pfad: Adapter ohne getAbsolutePath nach asDailyAnalystAdapterHost kein TypeError", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-adapter-"));
		const raw = makeHost(
			{ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test", timezone: "Europe/Berlin" },
			dir,
		);
		const adapterLike = Object.assign(raw, {
			namespace: "ems.0",
			getAbsoluteInstanceDataDir: () => dir,
		});
		delete (adapterLike as { getAbsolutePath?: unknown }).getAbsolutePath;
		assert.equal(
			typeof (adapterLike as { getAbsolutePath?: unknown }).getAbsolutePath,
			"undefined",
			"Roh-Adapter hat kein getAbsolutePath — Produktionsfall",
		);
		const host = asDailyAnalystAdapterHost(adapterLike as unknown as ioBroker.Adapter);
		assert.equal(typeof host.getAbsolutePath, "function");
		const admin = await runDailyAnalystFromAdminButton(host, NOW, silentProvider());
		assert.notEqual(admin.hint, "host.getAbsolutePath is not a function");
		assert.equal(
			raw.writes.some((w) => w.id === AI_ANALYST_STATES.runNowRequest && w.val === true),
			true,
		);
		assert.equal(admin.status, "no_data");
		assert.equal(admin.result, "ok");
	});

	it("fehlendes getAbsolutePath ohne Wrap wirft nicht, sondern liefert sauberen Fehler", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-nopath-"));
		const host = makeHost({ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test" }, dir);
		delete (host as { getAbsolutePath?: unknown }).getAbsolutePath;
		const admin = await runDailyAnalystFromAdminButton(host, NOW, silentProvider());
		assert.equal(admin.result, "error");
		assert.equal(admin.status, "error");
		assert.match(admin.hint, /Datenpfad/);
		assert.equal(String(admin.hint).includes("is not a function"), false);
	});
});

describe("formatAiDailyAnalystAdminHint", () => {
	it("mappt die Admin-Kurzmeldungen ohne JSON-Dump", () => {
		assert.equal(
			formatAiDailyAnalystAdminHint({
				ran: false,
				status: "disabled",
				dateKey: null,
				findings: [],
				reasonDe: "x",
				usage: { promptTokens: null, completionTokens: null },
			}),
			"Daily Analyst ist deaktiviert",
		);
		assert.equal(
			formatAiDailyAnalystAdminHint({
				ran: true,
				status: "ok",
				dateKey: YESTERDAY,
				findings: [numericFinding()],
				reasonDe: "lang",
				usage: { promptTokens: 1, completionTokens: 1 },
			}),
			"abgeschlossen",
		);
	});
});

function thermalDupFindings(): AiAnalystFinding[] {
	return [
		{
			findingType: "thermal_optimization",
			domain: "thermal",
			severity: "notice",
			confidencePct: 70,
			evidence: ["Heizstab 10 min / 0,29 kWh."],
			observedBehaviorDe:
				"Heizstab 10 min / 0,29 kWh, decisionQuality=avoidable, besseres PV-/Preisfenster verfügbar.",
			suggestedImprovementDe: "Heizstab in das günstigere PV-/Preisfenster legen.",
			affectedParameter: null,
			proposedNumericValue: null,
			expectedDirection: "cost_down",
			uncertaintyDe: "Nur ein Lauf.",
			dateKey: YESTERDAY,
		},
		{
			findingType: "thermal_optimization",
			domain: "thermal",
			severity: "info",
			confidencePct: 70,
			evidence: ["Heizstab 10 min / 0,29 kWh."],
			observedBehaviorDe:
				"Heizstab 10 min / 0,29 kWh, decisionQuality=early, besseres PV-/Preisfenster verfügbar.",
			suggestedImprovementDe: "Heizstab in das günstigere PV-/Preisfenster legen.",
			affectedParameter: null,
			proposedNumericValue: null,
			expectedDirection: "cost_down",
			uncertaintyDe: "Nur ein Lauf.",
			dateKey: YESTERDAY,
		},
	];
}

describe("Daily Analyst — zentrale KI-Kostenbuchhaltung", () => {
	it("manueller Daily Analyst zählt als API-Aufruf in ai.calls_today / Kosten", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-cost-"));
		const host = makeHost(
			{ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test", timezone: "Europe/Berlin" },
			dir,
		);
		await writeScoresDay(host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord(YESTERDAY));
		const counted = countingProvider();
		const r = await runDailyAnalystManual(host, NOW, counted.provider);
		assert.equal(r.status, "ok");
		assert.equal(counted.calls.n, 1);
		assert.equal(host.states.get(AI_STATES.callsToday), 1);
		assert.equal(host.states.get(AI_STATES.callsTodayDate), "2026-08-31");
		const expected = estimateCostEur("gpt-4.1-mini", 8_000, 400);
		assert.ok(expected > 0);
		assert.equal(host.states.get(AI_STATES.costEstimateTodayEur), expected);
		assert.equal(host.states.get(AI_STATES.costEstimateMonthEur), expected);
		assert.equal(host.states.get(AI_STATES.costMonthKey), "2026-08");
		assert.equal(host.states.get(AI_STATES.lastCallCategory), "daily_analyst");
	});

	it("kein API-Aufruf (no_data) → keine Kostenbuchung", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-nodata-"));
		const host = makeHost(
			{ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test", timezone: "Europe/Berlin" },
			dir,
		);
		const r = await runDailyAnalystManual(host, NOW, silentProvider());
		assert.equal(r.status, "no_data");
		assert.equal(host.states.get(AI_STATES.callsToday) ?? 0, 0);
		assert.equal(host.states.get(AI_STATES.costEstimateTodayEur) ?? 0, 0);
	});

	it("fehlgeschlagener Request zählt trotzdem als Call (bestehende Semantik)", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-fail-"));
		const host = makeHost(
			{ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test", timezone: "Europe/Berlin" },
			dir,
		);
		await writeScoresDay(host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord(YESTERDAY));
		const fail: AiAnalystProvider = {
			analyze: async () => ({
				ok: false,
				findings: [],
				reasonDe: "OpenAI-Fehler (500).",
				usage: { promptTokens: 20, completionTokens: 0 },
				error: "http_500",
			}),
		};
		const r = await runDailyAnalystManual(host, NOW, fail);
		assert.equal(r.status, "error");
		assert.equal(host.states.get(AI_STATES.callsToday), 1);
		assert.equal(host.states.get(AI_STATES.costEstimateTodayEur), estimateCostEur("gpt-4.1-mini", 20, 0));
	});

	it("operativer KI-Aufruf + Daily Analyst werden gemeinsam gezählt", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-share-"));
		const host = makeHost(
			{ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test", timezone: "Europe/Berlin" },
			dir,
		);
		await recordDailyCall(host, 20, 0.01, NOW, 0, "Europe/Berlin", "planner_optimization");
		await writeScoresDay(host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord(YESTERDAY));
		await runDailyAnalystManual(host, NOW, countingProvider().provider);
		assert.equal(host.states.get(AI_STATES.callsToday), 2);
		assert.equal(host.states.get(AI_STATES.lastCallCategory), "daily_analyst");
		const analystCost = estimateCostEur("gpt-4.1-mini", 8_000, 400);
		assert.equal(host.states.get(AI_STATES.costEstimateTodayEur), Math.round((0.01 + analystCost) * 100_000) / 100_000);
	});

	it("bestehendes Call-Limit kann vom Daily Analyst nicht umgangen werden", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-limit-"));
		const host = makeHost(
			{
				ai_analyst_mode: "manual",
				ai_openai_api_key: "sk-test",
				ai_max_calls_per_day: 1,
				timezone: "Europe/Berlin",
			},
			dir,
		);
		await recordDailyCall(host, 1, 0.01, NOW, 0, "Europe/Berlin", "planner_optimization");
		await writeScoresDay(host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord(YESTERDAY));
		const counted = countingProvider();
		const r = await runDailyAnalystManual(host, NOW, counted.provider);
		assert.equal(counted.calls.n, 0);
		assert.equal(r.status, "error");
		assert.equal(r.error, "limit_reached");
		assert.equal(host.states.get(AI_STATES.callsToday), 1);
	});

	it("bestehendes Monatslimit kann vom Daily Analyst nicht umgangen werden", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-month-"));
		const host = makeHost(
			{
				ai_analyst_mode: "manual",
				ai_openai_api_key: "sk-test",
				ai_monthly_cost_limit_eur: 0.05,
				timezone: "Europe/Berlin",
			},
			dir,
		);
		host.states.set(AI_STATES.costMonthKey, "2026-08");
		host.states.set(AI_STATES.costEstimateMonthEur, 0.05);
		host.states.set(AI_STATES.callsTodayDate, "2026-08-31");
		await writeScoresDay(host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord(YESTERDAY));
		const counted = countingProvider();
		const r = await runDailyAnalystManual(host, NOW, counted.provider);
		assert.equal(counted.calls.n, 0);
		assert.equal(r.error, "limit_reached");
		assert.equal(host.states.get(AI_STATES.callsToday) ?? 0, 0);
	});

	it("Tageswechsel setzt calls_today zurück, Monat bleibt", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-dayroll-"));
		const host = makeHost(
			{ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test", timezone: "Europe/Berlin" },
			dir,
		);
		await writeScoresDay(host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord("2026-08-29"));
		await runDailyAnalystForDate(host, "2026-08-29", countingProvider().provider, new Date("2026-08-30T22:00:00+02:00"));
		assert.equal(host.states.get(AI_STATES.callsToday), 1);
		assert.equal(host.states.get(AI_STATES.callsTodayDate), "2026-08-30");
		const monthBefore = host.states.get(AI_STATES.costEstimateMonthEur);
		await writeScoresDay(host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord(YESTERDAY));
		await runDailyAnalystForDate(host, YESTERDAY, countingProvider().provider, NOW);
		assert.equal(host.states.get(AI_STATES.callsToday), 1);
		assert.equal(host.states.get(AI_STATES.callsTodayDate), "2026-08-31");
		assert.ok(Number(host.states.get(AI_STATES.costEstimateMonthEur)) > Number(monthBefore));
	});

	it("Monatswechsel setzt cost_estimate_month_eur zurück", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-monthroll-"));
		const host = makeHost(
			{ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test", timezone: "Europe/Berlin" },
			dir,
		);
		host.states.set(AI_STATES.costMonthKey, "2026-07");
		host.states.set(AI_STATES.costEstimateMonthEur, 0.5);
		await writeScoresDay(host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord(YESTERDAY));
		await runDailyAnalystManual(host, NOW, countingProvider().provider);
		assert.equal(host.states.get(AI_STATES.costMonthKey), "2026-08");
		assert.equal(host.states.get(AI_STATES.costEstimateMonthEur), estimateCostEur("gpt-4.1-mini", 8_000, 400));
	});
});

describe("Daily Analyst — Findings Dedup + VIS-Text", () => {
	it("persistiert nach Dedup ein Finding und schreibt findings_de mit allen Einträgen", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-dedupe-"));
		const host = makeHost(
			{ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test", timezone: "Europe/Berlin" },
			dir,
		);
		await writeScoresDay(host.getAbsolutePath(DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord(YESTERDAY));
		const r = await runDailyAnalystManual(host, NOW, countingProvider(thermalDupFindings()).provider);
		assert.equal(r.findings.length, 1);
		assert.equal(host.states.get(AI_ANALYST_STATES.findingsCount), 1);
		const listed = String(host.states.get(AI_ANALYST_STATES.findingsDe) ?? "");
		assert.match(listed, /^1\. /);
		assert.equal(listed.includes("\n2. "), false);
		const persisted = await readAiAnalystDay(host.getAbsolutePath(AI_ANALYST_FINDINGS_CATEGORY), YESTERDAY);
		assert.equal(persisted?.findings.length, 1);
		assert.equal(persisted?.findings.length, host.states.get(AI_ANALYST_STATES.findingsCount));
	});
});

