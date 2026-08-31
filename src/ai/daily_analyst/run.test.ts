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

const NOW = new Date("2026-08-31T10:00:00+02:00");
const YESTERDAY = "2026-08-30";

function silentProvider(): AiAnalystProvider {
	return {
		analyze: async () => {
			throw new Error("Provider darf bei disabled/no_token nicht aufgerufen werden");
		},
	};
}

function countingProvider(findings: AiAnalystFinding[] = []): { provider: AiAnalystProvider; calls: { n: number } } {
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
					usage: { promptTokens: 1, completionTokens: 1 },
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
