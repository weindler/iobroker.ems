import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAiAnalystResponse } from "./validate_response";

function validFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

describe("validateAiAnalystResponse", () => {
	it("akzeptiert eine korrekt strukturierte Antwort", () => {
		const r = validateAiAnalystResponse({ findings: [validFinding()] }, "2026-08-29");
		assert.equal(r.ok, true);
		if (r.ok) {
			assert.equal(r.findings.length, 1);
			assert.equal(r.findings[0]?.dateKey, "2026-08-29");
			assert.equal(r.findings[0]?.domain, "battery");
		}
	});

	it("akzeptiert leeres findings-Array (unauffälliger Tag)", () => {
		const r = validateAiAnalystResponse({ findings: [] }, "2026-08-29");
		assert.equal(r.ok, true);
		if (r.ok) assert.equal(r.findings.length, 0);
	});

	it("verwirft die gesamte Antwort, wenn findings kein Array ist", () => {
		const r = validateAiAnalystResponse({ findings: "oops" }, "2026-08-29");
		assert.equal(r.ok, false);
	});

	it("verwirft die gesamte Antwort ohne findings-Feld", () => {
		const r = validateAiAnalystResponse({}, "2026-08-29");
		assert.equal(r.ok, false);
	});

	it("verwirft einzelne Findings mit ungültiger domain, behält den Rest", () => {
		const r = validateAiAnalystResponse(
			{ findings: [validFinding({ domain: "not_a_real_domain" }), validFinding()] },
			"2026-08-29",
		);
		assert.equal(r.ok, true);
		if (r.ok) assert.equal(r.findings.length, 1);
	});

	it("verwirft Findings mit confidence_pct außerhalb 0..100", () => {
		const r = validateAiAnalystResponse({ findings: [validFinding({ confidence_pct: 140 })] }, "2026-08-29");
		assert.equal(r.ok, true);
		if (r.ok) assert.equal(r.findings.length, 0);
	});

	it("verwirft Findings ohne evidence (kein Beleg = keine erfundene Aussage)", () => {
		const r = validateAiAnalystResponse({ findings: [validFinding({ evidence: [] })] }, "2026-08-29");
		assert.equal(r.ok, true);
		if (r.ok) assert.equal(r.findings.length, 0);
	});

	it("übernimmt proposed_numeric_value, wenn es eine gültige Zahl ist", () => {
		const r = validateAiAnalystResponse(
			{ findings: [validFinding({ affected_parameter: "battery.opportunity_margin_ct", proposed_numeric_value: 2 })] },
			"2026-08-29",
		);
		assert.equal(r.ok, true);
		if (r.ok) assert.equal(r.findings[0]?.proposedNumericValue, 2);
	});

	it("setzt proposedNumericValue=null statt zu raten, wenn das Feld ungültig ist", () => {
		const r = validateAiAnalystResponse(
			{ findings: [validFinding({ proposed_numeric_value: "foo" })] },
			"2026-08-29",
		);
		assert.equal(r.ok, true);
		if (r.ok) assert.equal(r.findings[0]?.proposedNumericValue, null);
	});
});
