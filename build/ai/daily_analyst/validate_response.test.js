"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const validate_response_1 = require("./validate_response");
function validFinding(overrides = {}) {
    return {
        finding_type: "late_flexible_load_during_battery_discharge",
        domain: "battery",
        severity: "notice",
        confidence_pct: 70,
        evidence: ["Mittags PV-Export, 18:00 Verbraucher aus Batterie."],
        observed_behavior_de: "Verbraucher lief aus Batterie, obwohl mittags PV-Überschuss da war.",
        suggested_improvement_de: "Frühere Nutzung des PV-Überschusses prüfen.",
        affected_parameter: null,
        proposed_numeric_value: null,
        expected_direction: "cost_down",
        uncertainty_de: "Kein Kausalnachweis, nur Korrelation.",
        ...overrides,
    };
}
(0, node_test_1.describe)("validateAiAnalystResponse", () => {
    (0, node_test_1.it)("akzeptiert eine korrekt strukturierte Antwort", () => {
        const r = (0, validate_response_1.validateAiAnalystResponse)({ findings: [validFinding()] }, "2026-08-29");
        strict_1.default.equal(r.ok, true);
        if (r.ok) {
            strict_1.default.equal(r.findings.length, 1);
            strict_1.default.equal(r.findings[0]?.dateKey, "2026-08-29");
            strict_1.default.equal(r.findings[0]?.domain, "battery");
        }
    });
    (0, node_test_1.it)("akzeptiert leeres findings-Array (unauffälliger Tag)", () => {
        const r = (0, validate_response_1.validateAiAnalystResponse)({ findings: [] }, "2026-08-29");
        strict_1.default.equal(r.ok, true);
        if (r.ok)
            strict_1.default.equal(r.findings.length, 0);
    });
    (0, node_test_1.it)("verwirft die gesamte Antwort, wenn findings kein Array ist", () => {
        const r = (0, validate_response_1.validateAiAnalystResponse)({ findings: "oops" }, "2026-08-29");
        strict_1.default.equal(r.ok, false);
    });
    (0, node_test_1.it)("verwirft die gesamte Antwort ohne findings-Feld", () => {
        const r = (0, validate_response_1.validateAiAnalystResponse)({}, "2026-08-29");
        strict_1.default.equal(r.ok, false);
    });
    (0, node_test_1.it)("verwirft einzelne Findings mit ungültiger domain, behält den Rest", () => {
        const r = (0, validate_response_1.validateAiAnalystResponse)({ findings: [validFinding({ domain: "not_a_real_domain" }), validFinding()] }, "2026-08-29");
        strict_1.default.equal(r.ok, true);
        if (r.ok)
            strict_1.default.equal(r.findings.length, 1);
    });
    (0, node_test_1.it)("verwirft Findings mit confidence_pct außerhalb 0..100", () => {
        const r = (0, validate_response_1.validateAiAnalystResponse)({ findings: [validFinding({ confidence_pct: 140 })] }, "2026-08-29");
        strict_1.default.equal(r.ok, true);
        if (r.ok)
            strict_1.default.equal(r.findings.length, 0);
    });
    (0, node_test_1.it)("verwirft Findings ohne evidence (kein Beleg = keine erfundene Aussage)", () => {
        const r = (0, validate_response_1.validateAiAnalystResponse)({ findings: [validFinding({ evidence: [] })] }, "2026-08-29");
        strict_1.default.equal(r.ok, true);
        if (r.ok)
            strict_1.default.equal(r.findings.length, 0);
    });
    (0, node_test_1.it)("übernimmt proposed_numeric_value, wenn es eine gültige Zahl ist", () => {
        const r = (0, validate_response_1.validateAiAnalystResponse)({ findings: [validFinding({ affected_parameter: "battery.opportunity_margin_ct", proposed_numeric_value: 2 })] }, "2026-08-29");
        strict_1.default.equal(r.ok, true);
        if (r.ok)
            strict_1.default.equal(r.findings[0]?.proposedNumericValue, 2);
    });
    (0, node_test_1.it)("setzt proposedNumericValue=null statt zu raten, wenn das Feld ungültig ist", () => {
        const r = (0, validate_response_1.validateAiAnalystResponse)({ findings: [validFinding({ proposed_numeric_value: "foo" })] }, "2026-08-29");
        strict_1.default.equal(r.ok, true);
        if (r.ok)
            strict_1.default.equal(r.findings[0]?.proposedNumericValue, null);
    });
});
