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
const allowlist_1 = require("./allowlist");
const ingest_1 = require("./ingest");
const persist_1 = require("./persist");
const validate_1 = require("./validate");
function finding(overrides = {}) {
    return {
        findingType: "grid_balance_too_shy",
        domain: "battery",
        severity: "notice",
        confidencePct: 80,
        evidence: ["SOC 91 %, Preis 39,6 ct, Reserve 3,5 kWh."],
        observedBehaviorDe: "Netzausgleich blieb trotz teurem Preis und hohem SOC zu.",
        suggestedImprovementDe: "Opportunity-Marge leicht senken.",
        affectedParameter: allowlist_1.AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT,
        proposedNumericValue: 2,
        expectedDirection: "cost_down",
        uncertaintyDe: "Nur ein Tag.",
        dateKey: "2026-08-30",
        ...overrides,
    };
}
(0, node_test_1.describe)("mergeOpportunityMarginWithOverride", () => {
    (0, node_test_1.it)("ohne Override bleibt die Basis-Marge", () => {
        strict_1.default.equal((0, allowlist_1.mergeOpportunityMarginWithOverride)(3, null), 3);
    });
    (0, node_test_1.it)("aktiver Override ersetzt die Basis", () => {
        strict_1.default.equal((0, allowlist_1.mergeOpportunityMarginWithOverride)(3, 2), 2);
    });
});
(0, node_test_1.describe)("ingestAnalystFindingsAsOverrides", () => {
    (0, node_test_1.it)("überspringt Findings ohne numerischen Vorschlag — kein Raten", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ov-"));
        const r = await (0, ingest_1.ingestAnalystFindingsAsOverrides)({ getAbsolutePath: () => dir }, [finding({ proposedNumericValue: null })], "2026-08-30");
        strict_1.default.equal(r.accepted, 0);
        strict_1.default.equal(r.skipped, 1);
    });
    (0, node_test_1.it)("lehnt Safety-Parameter ab, auch wenn die KI sie vorschlägt", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ov-"));
        const r = await (0, ingest_1.ingestAnalystFindingsAsOverrides)({ getAbsolutePath: () => dir }, [finding({ affectedParameter: "battery.soc_hard_min_pct", proposedNumericValue: 2 })], "2026-08-30");
        strict_1.default.equal(r.accepted, 0);
        strict_1.default.equal(r.skipped, 1);
    });
    (0, node_test_1.it)("akzeptiert Allowlist-Parameter innerhalb der Bounds und schreibt ins Ledger", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ov-"));
        const r = await (0, ingest_1.ingestAnalystFindingsAsOverrides)({ getAbsolutePath: () => dir }, [finding()], "2026-08-30", new Date("2026-08-31T08:00:00Z"));
        strict_1.default.equal(r.accepted, 1);
        strict_1.default.equal(r.overrides[0]?.status, "active");
        strict_1.default.equal(r.overrides[0]?.validatedValue, 2);
        const store = await (0, persist_1.readOverrideLedgerStore)(dir);
        strict_1.default.equal(store.overrides.length, 1);
    });
    (0, node_test_1.it)("lehnt Änderung über maxChangePerStep ab", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ov-"));
        const r = await (0, ingest_1.ingestAnalystFindingsAsOverrides)({ getAbsolutePath: () => dir }, [finding({ proposedNumericValue: 9 })], "2026-08-30");
        strict_1.default.equal(r.rejected, 1);
        strict_1.default.equal(r.overrides[0]?.status, "rejected");
    });
    (0, node_test_1.it)("TTL: nach Ablauf gilt der Override nicht mehr", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ov-"));
        const created = new Date("2026-08-31T08:00:00Z");
        await (0, ingest_1.ingestAnalystFindingsAsOverrides)({ getAbsolutePath: () => dir }, [finding()], "2026-08-30", created);
        const later = new Date(created.getTime() + 25 * 60 * 60 * 1000);
        const store = await (0, persist_1.readOverrideLedgerStore)(dir);
        const swept = (0, validate_1.sweepExpiredOverrides)(store.overrides, later);
        strict_1.default.equal(swept[0]?.status, "expired");
    });
});
