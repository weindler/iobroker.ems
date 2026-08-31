"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const run_1 = require("./run");
const ensure_states_1 = require("./ensure_states");
const constants_1 = require("../../learning/daily_evaluator/constants");
const persist_1 = require("../../learning/daily_evaluator/persist");
const persist_2 = require("../override/persist");
const allowlist_1 = require("../override/allowlist");
const NOW = new Date("2026-08-31T10:00:00+02:00");
const YESTERDAY = "2026-08-30";
function silentProvider() {
    return {
        analyze: async () => {
            throw new Error("Provider darf bei disabled/no_token nicht aufgerufen werden");
        },
    };
}
function countingProvider(findings = []) {
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
function numericFinding() {
    return {
        findingType: "grid_balance_too_shy",
        domain: "battery",
        severity: "notice",
        confidencePct: 80,
        evidence: ["SOC 91 %."],
        observedBehaviorDe: "Netzausgleich blieb zu.",
        suggestedImprovementDe: "Opportunity-Marge leicht senken.",
        affectedParameter: allowlist_1.AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT,
        proposedNumericValue: 2,
        expectedDirection: "cost_down",
        uncertaintyDe: "Nur ein Tag.",
        dateKey: YESTERDAY,
    };
}
function scoresRecord(dateKey) {
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
function makeHost(config, dir) {
    const states = new Map();
    const writes = [];
    const host = {
        states,
        writes,
        config,
        getAbsolutePath: (category) => (category ? path.join(dir, ...category.split("/")) : dir),
        getStateAsync: async (id) => {
            if (!states.has(id))
                return null;
            return { val: states.get(id) };
        },
        setStateAsync: async (id, state) => {
            const s = state;
            writes.push({ id, val: s.val, ack: s.ack });
            states.set(id, s.val);
        },
        setObjectNotExistsAsync: async () => undefined,
        log: { warn: () => undefined, debug: () => undefined, error: () => undefined },
    };
    return host;
}
(0, node_test_1.describe)("runDailyAnalystForDate — EMS läuft ohne KI weiter", () => {
    (0, node_test_1.it)("status=disabled ohne Provider-Aufruf, wenn Admin-Modus disabled", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
        const r = await (0, run_1.runDailyAnalystForDate)(makeHost({ ai_analyst_mode: "disabled", ai_openai_api_key: "sk-test" }, dir), YESTERDAY, silentProvider());
        strict_1.default.equal(r.status, "disabled");
        strict_1.default.equal(r.ran, false);
        strict_1.default.equal(r.findings.length, 0);
    });
    (0, node_test_1.it)("status=no_token ohne Provider-Aufruf, wenn kein API-Key gesetzt ist", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
        const r = await (0, run_1.runDailyAnalystForDate)(makeHost({ ai_analyst_mode: "manual", ai_openai_api_key: "" }, dir), YESTERDAY, silentProvider());
        strict_1.default.equal(r.status, "no_token");
        strict_1.default.equal(r.ran, false);
        strict_1.default.equal(r.findings.length, 0);
    });
});
(0, node_test_1.describe)("Admin-Config → Runtime-States", () => {
    (0, node_test_1.it)("disabled Admin → enabled=false, mode_effective=disabled, status=disabled", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
        const host = makeHost({ ai_analyst_mode: "disabled" }, dir);
        await (0, ensure_states_1.syncAiDailyAnalystRuntimeFromConfig)(host);
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.enabled), false);
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.modeEffective), "disabled");
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.status), "disabled");
    });
    (0, node_test_1.it)("manual Admin → enabled=true, mode_effective=manual", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
        const host = makeHost({ ai_analyst_mode: "manual" }, dir);
        await (0, ensure_states_1.syncAiDailyAnalystRuntimeFromConfig)(host);
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.enabled), true);
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.modeEffective), "manual");
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.status), "idle");
    });
    (0, node_test_1.it)("daily_auto Admin → enabled=true, mode_effective=daily_auto", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
        const host = makeHost({ ai_analyst_mode: "daily_auto" }, dir);
        await (0, ensure_states_1.syncAiDailyAnalystRuntimeFromConfig)(host);
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.enabled), true);
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.modeEffective), "daily_auto");
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.status), "idle");
    });
    (0, node_test_1.it)("Persistenz nach Adapter-Neustart: Ensure-Defaults überschreiben manual nicht, Sync stellt den Modus wieder her", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
        const host = makeHost({ ai_analyst_mode: "disabled" }, dir);
        await (0, ensure_states_1.ensureAiDailyAnalystStates)(host);
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.modeEffective), "disabled");
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.enabled), false);
        host.config = { ai_analyst_mode: "manual" };
        await (0, ensure_states_1.ensureAiDailyAnalystStates)(host);
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.modeEffective), "disabled", "Ensure darf vorhandene Werte nicht mit disabled überschreiben");
        await (0, ensure_states_1.syncAiDailyAnalystRuntimeFromConfig)(host);
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.modeEffective), "manual");
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.enabled), true);
        await (0, ensure_states_1.ensureAiDailyAnalystStates)(host);
        await (0, ensure_states_1.syncAiDailyAnalystRuntimeFromConfig)(host);
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.modeEffective), "manual");
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.enabled), true);
        strict_1.default.notEqual(host.states.get(ensure_states_1.AI_ANALYST_STATES.status), "disabled");
    });
});
(0, node_test_1.describe)("Jetzt analysieren / run_now_request", () => {
    (0, node_test_1.it)("disabled verhindert den Lauf und erklärt ihn", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
        const host = makeHost({ ai_analyst_mode: "disabled", ai_openai_api_key: "sk-test" }, dir);
        const admin = await (0, run_1.runDailyAnalystFromAdminButton)(host, NOW, silentProvider());
        strict_1.default.equal(admin.result, "error");
        strict_1.default.equal(admin.status, "disabled");
        strict_1.default.equal(admin.hint, "Daily Analyst ist deaktiviert");
        strict_1.default.equal(host.writes.some((w) => w.id === ensure_states_1.AI_ANALYST_STATES.runNowRequest && w.val === true), false);
        const manual = await (0, run_1.runDailyAnalystManual)(host, NOW, silentProvider());
        strict_1.default.equal(manual.ran, false);
        strict_1.default.equal(manual.status, "disabled");
    });
    (0, node_test_1.it)("Button triggert run_now_request und startet im Modus manual", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
        const host = makeHost({ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test" }, dir);
        const admin = await (0, run_1.runDailyAnalystFromAdminButton)(host, NOW, silentProvider());
        strict_1.default.equal(host.writes.some((w) => w.id === ensure_states_1.AI_ANALYST_STATES.runNowRequest && w.val === true), true);
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.runNowRequest), false);
        strict_1.default.equal(admin.status, "no_data");
        strict_1.default.equal(admin.hint, "kein evaluierter Tag verfügbar");
    });
    (0, node_test_1.it)("kein Token → sauber no_token", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
        const host = makeHost({ ai_analyst_mode: "manual" }, dir);
        const admin = await (0, run_1.runDailyAnalystFromAdminButton)(host, NOW, silentProvider());
        strict_1.default.equal(admin.status, "no_token");
        strict_1.default.equal(admin.hint, "no_token");
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.status), "no_token");
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.modeEffective), "manual");
        strict_1.default.equal(host.states.get(ensure_states_1.AI_ANALYST_STATES.enabled), true);
    });
    (0, node_test_1.it)("manual startet einen Lauf, sobald ein evaluierter Tag da ist", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
        const host = makeHost({ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test", timezone: "Europe/Berlin" }, dir);
        await (0, persist_1.writeScoresDay)(host.getAbsolutePath(constants_1.DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord(YESTERDAY));
        const counted = countingProvider();
        const r = await (0, run_1.runDailyAnalystManual)(host, NOW, counted.provider);
        strict_1.default.equal(counted.calls.n, 1);
        strict_1.default.equal(r.ran, true);
        strict_1.default.equal(r.status, "ok");
    });
    (0, node_test_1.it)("daily_auto: erster Lauf ja, zweiter Zusatzlauf durch Deduplizierung übersprungen", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
        const host = makeHost({ ai_analyst_mode: "daily_auto", ai_openai_api_key: "sk-test", timezone: "Europe/Berlin" }, dir);
        await (0, persist_1.writeScoresDay)(host.getAbsolutePath(constants_1.DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord(YESTERDAY));
        const counted = countingProvider();
        const first = await (0, run_1.runDailyAnalystFromAdminButton)(host, NOW, counted.provider);
        strict_1.default.equal(first.status, "ok");
        strict_1.default.equal(counted.calls.n, 1);
        const second = await (0, run_1.runDailyAnalystFromAdminButton)(host, NOW, counted.provider);
        strict_1.default.equal(counted.calls.n, 1);
        strict_1.default.equal(second.status, "ok");
        strict_1.default.equal(second.hint, "abgeschlossen");
        const auto = await (0, run_1.maybeRunDailyAnalystAutomatically)(host, NOW, silentProvider());
        strict_1.default.equal(auto, null);
    });
    (0, node_test_1.it)("manueller Lauf ohne Override-Haken schreibt keine Planner-Overrides", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-"));
        const host = makeHost({
            ai_analyst_mode: "manual",
            ai_openai_api_key: "sk-test",
            ai_override_enabled: false,
            timezone: "Europe/Berlin",
        }, dir);
        await (0, persist_1.writeScoresDay)(host.getAbsolutePath(constants_1.DAILY_EVALUATOR_SCORES_CATEGORY), scoresRecord(YESTERDAY));
        const counted = countingProvider([numericFinding()]);
        const r = await (0, run_1.runDailyAnalystManual)(host, NOW, counted.provider);
        strict_1.default.equal(r.status, "ok");
        strict_1.default.equal(r.findings.length, 1);
        const ledger = await (0, persist_2.readOverrideLedgerStore)(host.getAbsolutePath(persist_2.AI_OVERRIDE_LEDGER_CATEGORY));
        strict_1.default.equal(ledger.overrides.length, 0);
    });
    (0, node_test_1.it)("sendTo-Pfad: Adapter ohne getAbsolutePath nach asDailyAnalystAdapterHost kein TypeError", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-adapter-"));
        const raw = makeHost({ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test", timezone: "Europe/Berlin" }, dir);
        const adapterLike = Object.assign(raw, {
            namespace: "ems.0",
            getAbsoluteInstanceDataDir: () => dir,
        });
        delete adapterLike.getAbsolutePath;
        strict_1.default.equal(typeof adapterLike.getAbsolutePath, "undefined", "Roh-Adapter hat kein getAbsolutePath — Produktionsfall");
        const host = (0, run_1.asDailyAnalystAdapterHost)(adapterLike);
        strict_1.default.equal(typeof host.getAbsolutePath, "function");
        const admin = await (0, run_1.runDailyAnalystFromAdminButton)(host, NOW, silentProvider());
        strict_1.default.notEqual(admin.hint, "host.getAbsolutePath is not a function");
        strict_1.default.equal(raw.writes.some((w) => w.id === ensure_states_1.AI_ANALYST_STATES.runNowRequest && w.val === true), true);
        strict_1.default.equal(admin.status, "no_data");
        strict_1.default.equal(admin.result, "ok");
    });
    (0, node_test_1.it)("fehlendes getAbsolutePath ohne Wrap wirft nicht, sondern liefert sauberen Fehler", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "analyst-nopath-"));
        const host = makeHost({ ai_analyst_mode: "manual", ai_openai_api_key: "sk-test" }, dir);
        delete host.getAbsolutePath;
        const admin = await (0, run_1.runDailyAnalystFromAdminButton)(host, NOW, silentProvider());
        strict_1.default.equal(admin.result, "error");
        strict_1.default.equal(admin.status, "error");
        strict_1.default.match(admin.hint, /Datenpfad/);
        strict_1.default.equal(String(admin.hint).includes("is not a function"), false);
    });
});
(0, node_test_1.describe)("formatAiDailyAnalystAdminHint", () => {
    (0, node_test_1.it)("mappt die Admin-Kurzmeldungen ohne JSON-Dump", () => {
        strict_1.default.equal((0, run_1.formatAiDailyAnalystAdminHint)({
            ran: false,
            status: "disabled",
            dateKey: null,
            findings: [],
            reasonDe: "x",
            usage: { promptTokens: null, completionTokens: null },
        }), "Daily Analyst ist deaktiviert");
        strict_1.default.equal((0, run_1.formatAiDailyAnalystAdminHint)({
            ran: true,
            status: "ok",
            dateKey: YESTERDAY,
            findings: [numericFinding()],
            reasonDe: "lang",
            usage: { promptTokens: 1, completionTokens: 1 },
        }), "abgeschlossen");
    });
});
