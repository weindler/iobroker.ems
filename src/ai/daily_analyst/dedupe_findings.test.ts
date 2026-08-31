import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dedupeAnalystFindings, formatAnalystFindingsDe, analystFindingEventKey } from "./dedupe_findings";
import type { AiAnalystFinding } from "./types";

function finding(overrides: Partial<AiAnalystFinding> = {}): AiAnalystFinding {
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

describe("dedupeAnalystFindings", () => {
	it("Produktionsfall: zwei Heizstab-Texte desselben Laufs → 1 Finding (notice bleibt)", () => {
		const notice = finding({
			severity: "notice",
			findingType: "avoidable",
			observedBehaviorDe:
				"Der Heizstab lief 10 Minuten und verbrauchte 0,29 kWh, obwohl ein günstigeres Zeitfenster verfügbar war.",
			suggestedImprovementDe:
				"Heizstab-Läufe sollten besser auf günstigere PV-/Preisfenster abgestimmt werden, um Kosten zu senken.",
			evidence: [],
		});
		const info = finding({
			severity: "info",
			findingType: "early",
			observedBehaviorDe: "Der Heizstab wurde frühzeitig aktiviert, was zu moderaten Kosten führte.",
			suggestedImprovementDe:
				"Eine spätere Aktivierung im besseren PV-/Preisfenster könnte die Wirtschaftlichkeit verbessern.",
			evidence: [],
		});
		const out = dedupeAnalystFindings([notice, info]);
		assert.equal(out.length, 1);
		assert.equal(out[0]?.severity, "notice");
		assert.match(out[0]?.observedBehaviorDe ?? "", /10 Minuten/);
	});

	it("führt zwei semantisch gleiche Heizstab-Findings desselben Laufs zu einem zusammen", () => {
		const avoidable = finding({
			severity: "notice",
			observedBehaviorDe:
				"Heizstab 10 min / 0,29 kWh, decisionQuality=avoidable, besseres PV-/Preisfenster verfügbar.",
		});
		const early = finding({
			severity: "info",
			observedBehaviorDe:
				"Heizstab 10 min / 0,29 kWh, decisionQuality=early, besseres PV-/Preisfenster verfügbar.",
		});
		assert.equal(analystFindingEventKey(avoidable), analystFindingEventKey(early));
		const out = dedupeAnalystFindings([avoidable, early]);
		assert.equal(out.length, 1);
		assert.equal(out[0]?.severity, "notice");
		assert.match(out[0]?.observedBehaviorDe ?? "", /avoidable/);
	});

	it("gleicher Lauf, andere Formulierung ohne Mengen → 1 Finding", () => {
		const withQty = finding({
			severity: "notice",
			observedBehaviorDe: "Heizstab 10 min / 0,29 kWh zu früh, besseres PV-Fenster.",
		});
		const prose = finding({
			severity: "info",
			findingType: "early_activation",
			observedBehaviorDe: "Der Heizstab wurde frühzeitig aktiviert.",
			suggestedImprovementDe: "Später im günstigeren Preisfenster aktivieren.",
			evidence: [],
		});
		assert.equal(dedupeAnalystFindings([withQty, prose]).length, 1);
	});

	it("lässt unterschiedliche echte Probleme getrennt", () => {
		const thermal = finding();
		const battery = finding({
			findingType: "grid_balance_too_shy",
			domain: "battery",
			evidence: ["SOC 91 %."],
			observedBehaviorDe: "Netzausgleich blieb zu.",
			suggestedImprovementDe: "Opportunity-Marge leicht senken.",
		});
		const out = dedupeAnalystFindings([thermal, battery]);
		assert.equal(out.length, 2);
	});

	it("zwei unterschiedliche Heizstab-Läufe bleiben getrennt", () => {
		const runA = finding({
			observedBehaviorDe: "Heizstab 10 min / 0,29 kWh zu früh, besseres PV-Fenster.",
		});
		const runB = finding({
			observedBehaviorDe: "Heizstab 25 min / 1,10 kWh zu früh, besseres PV-Fenster.",
		});
		assert.equal(dedupeAnalystFindings([runA, runB]).length, 2);
	});

	it("behält die stärkere Severity und vereinigt Evidence", () => {
		const weak = finding({
			severity: "info",
			confidencePct: 55,
			evidence: ["Heizstab 10 min / 0,29 kWh."],
		});
		const strong = finding({
			severity: "warning",
			confidencePct: 80,
			evidence: ["Heizstab 10 min / 0,29 kWh, Fenster 11:00."],
			observedBehaviorDe:
				"Heizstab 10 min / 0,29 kWh, decisionQuality=avoidable, besseres PV-/Preisfenster verfügbar.",
		});
		const out = dedupeAnalystFindings([weak, strong]);
		assert.equal(out.length, 1);
		assert.equal(out[0]?.severity, "warning");
		assert.equal(out[0]?.confidencePct, 80);
		assert.equal(out[0]?.evidence.length, 2);
	});

	it("findings_count der Ausgabe entspricht der persistierbaren Liste", () => {
		const a = finding();
		const dup = finding({
			severity: "notice",
			observedBehaviorDe:
				"Heizstab 10 min / 0,29 kWh, decisionQuality=avoidable, besseres PV-/Preisfenster verfügbar.",
		});
		const other = finding({
			findingType: "late_flexible_load",
			domain: "battery",
			evidence: ["Mittags PV-Export."],
			observedBehaviorDe: "Verbraucher lief aus Batterie.",
			suggestedImprovementDe: "Frühere PV-Nutzung prüfen.",
		});
		const out = dedupeAnalystFindings([a, dup, other]);
		assert.equal(out.length, 2);
		const vis = formatAnalystFindingsDe(out);
		assert.match(vis, /^1\. /);
		assert.match(vis, /\n\n2\. /);
		assert.equal(vis.includes("3."), false);
	});
});
