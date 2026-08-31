"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const dedupe_findings_1 = require("./dedupe_findings");
function finding(overrides = {}) {
    return {
        findingType: "thermal_optimization",
        domain: "thermal",
        severity: "info",
        confidencePct: 70,
        evidence: ["Heizstab 10 min / 0,29 kWh."],
        observedBehaviorDe: "Heizstab 10 min / 0,29 kWh, decisionQuality=early, besseres PV-/Preisfenster verfügbar.",
        suggestedImprovementDe: "Heizstab in das günstigere PV-/Preisfenster legen.",
        affectedParameter: null,
        proposedNumericValue: null,
        expectedDirection: "cost_down",
        uncertaintyDe: "Nur ein Lauf.",
        dateKey: "2026-08-30",
        ...overrides,
    };
}
(0, node_test_1.describe)("dedupeAnalystFindings", () => {
    (0, node_test_1.it)("führt zwei semantisch gleiche Heizstab-Findings desselben Laufs zu einem zusammen", () => {
        const avoidable = finding({
            severity: "notice",
            observedBehaviorDe: "Heizstab 10 min / 0,29 kWh, decisionQuality=avoidable, besseres PV-/Preisfenster verfügbar.",
        });
        const early = finding({
            severity: "info",
            observedBehaviorDe: "Heizstab 10 min / 0,29 kWh, decisionQuality=early, besseres PV-/Preisfenster verfügbar.",
        });
        strict_1.default.equal((0, dedupe_findings_1.analystFindingEventKey)(avoidable), (0, dedupe_findings_1.analystFindingEventKey)(early));
        const out = (0, dedupe_findings_1.dedupeAnalystFindings)([avoidable, early]);
        strict_1.default.equal(out.length, 1);
        strict_1.default.equal(out[0]?.severity, "notice");
        strict_1.default.match(out[0]?.observedBehaviorDe ?? "", /avoidable/);
    });
    (0, node_test_1.it)("lässt unterschiedliche echte Probleme getrennt", () => {
        const thermal = finding();
        const battery = finding({
            findingType: "grid_balance_too_shy",
            domain: "battery",
            evidence: ["SOC 91 %."],
            observedBehaviorDe: "Netzausgleich blieb zu.",
            suggestedImprovementDe: "Opportunity-Marge leicht senken.",
        });
        const out = (0, dedupe_findings_1.dedupeAnalystFindings)([thermal, battery]);
        strict_1.default.equal(out.length, 2);
    });
    (0, node_test_1.it)("behält die stärkere Severity und vereinigt Evidence", () => {
        const weak = finding({
            severity: "info",
            confidencePct: 55,
            evidence: ["Heizstab 10 min / 0,29 kWh."],
        });
        const strong = finding({
            severity: "warning",
            confidencePct: 80,
            evidence: ["Heizstab 10 min / 0,29 kWh, Fenster 11:00."],
            observedBehaviorDe: "Heizstab 10 min / 0,29 kWh, decisionQuality=avoidable, besseres PV-/Preisfenster verfügbar.",
        });
        const out = (0, dedupe_findings_1.dedupeAnalystFindings)([weak, strong]);
        strict_1.default.equal(out.length, 1);
        strict_1.default.equal(out[0]?.severity, "warning");
        strict_1.default.equal(out[0]?.confidencePct, 80);
        strict_1.default.equal(out[0]?.evidence.length, 2);
    });
    (0, node_test_1.it)("findings_count der Ausgabe entspricht der persistierbaren Liste", () => {
        const a = finding();
        const dup = finding({
            severity: "notice",
            observedBehaviorDe: "Heizstab 10 min / 0,29 kWh, decisionQuality=avoidable, besseres PV-/Preisfenster verfügbar.",
        });
        const other = finding({
            findingType: "late_flexible_load",
            domain: "battery",
            evidence: ["Mittags PV-Export."],
            observedBehaviorDe: "Verbraucher lief aus Batterie.",
            suggestedImprovementDe: "Frühere PV-Nutzung prüfen.",
        });
        const out = (0, dedupe_findings_1.dedupeAnalystFindings)([a, dup, other]);
        strict_1.default.equal(out.length, 2);
        const vis = (0, dedupe_findings_1.formatAnalystFindingsDe)(out);
        strict_1.default.match(vis, /^1\. /);
        strict_1.default.match(vis, /\n\n2\. /);
        strict_1.default.equal(vis.includes("3."), false);
    });
});
