/**
 * VIS-Regression: KI Advisory vs. Steuerplan (Plan A Authority).
 * Keine Runtime-/Writeback-Logik — nur Produktsemantik in ems-charts.html.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const visHtml = readFileSync(join(dir, "ems-charts.html"), "utf8");
const adminHtml = readFileSync(join(dir, "..", "admin", "ems-charts.html"), "utf8");

function extractScript(html) {
	const start = html.indexOf("<script>");
	const end = html.lastIndexOf("</script>");
	assert.ok(start >= 0 && end > start, "ems-charts.html must contain a script block");
	return html.slice(start + "<script>".length, end);
}

describe("VIS AI advisory vs control-plan semantics", () => {
	it("vis and admin ems-charts.html stay in sync", () => {
		assert.equal(visHtml, adminHtml);
	});

	it("ems-charts.html script parses (no syntax error / Verbinde hang)", () => {
		assert.doesNotThrow(() => new Function(extractScript(visHtml)));
		assert.doesNotThrow(() => new Function(extractScript(adminHtml)));
	});

	it("A) never claims Plan B is actively controlling in product copy", () => {
		assert.equal(visHtml.includes("Plan B aktiv"), false);
		assert.equal(visHtml.includes("Plan B steuert"), false);
		assert.equal(/Ja\s*—\s*Plan B/.test(visHtml), false);
	});

	it("B) AI on + compare a → Regelwerk/Plan A as Steuerplan", () => {
		assert.match(visHtml, /controlPlanLabel\s*=\s*"Regelwerk \(Plan A\)"/);
		assert.match(visHtml, /Steuerung:\s*'\+esc\(v\.controlPlanLabel\)/);
		assert.match(visHtml, /Aktiver Steuerplan/);
		assert.match(visHtml, /EMS führt Plan A aus/);
	});

	it("C) compare winner b is only advisory / KI-Vorschlag", () => {
		assert.match(visHtml, /KI-Vorschlag: Plan B wäre günstiger\/besser/);
		assert.match(visHtml, /prefersB\s*=\s*compareWinner\s*===\s*"b"/);
		assert.match(visHtml, /compareLabel="KI-Vorschlag: Plan B wäre günstiger\/besser"/);
		assert.match(visHtml, /controlPlanLabel="Regelwerk \(Plan A\)"/);
	});

	it("D) Δ≈0 → kein messbarer Vorteil", () => {
		assert.match(visHtml, /KI geprüft – kein messbarer Vorteil/);
		assert.match(visHtml, /noMeasurable/);
	});

	it("E) AI live mutation off → no Plan-B live authority suggestion", () => {
		assert.match(visHtml, /AI_ALLOCATION_LIVE_MUTATION_ENABLED=false/);
		assert.match(visHtml, /KI nur Vergleich/);
		assert.match(visHtml, /KI deaktiviert/);
		assert.match(visHtml, /KI aktiv – Vergleich läuft/);
		assert.match(visHtml, /Compare-Winner ist keine Live-Authority/);
		assert.equal(visHtml.includes("Plan B Live"), false);
		assert.equal(visHtml.includes("Plan B steuert"), false);
	});

	it("uses existing AI/compare states (no new state ids for verdict)", () => {
		assert.match(visHtml, /g\("ai\.status"\)/);
		assert.match(visHtml, /g\("compare\.active_plan"\)/);
		assert.match(visHtml, /g\("compare\.delta_summary_json"\)/);
		assert.match(visHtml, /deltaCostCt|Δ Kosten/);
		assert.match(visHtml, /Δ Netz/);
		assert.match(visHtml, /Δ PV/);
	});

	it("runtime KI toggle writes ai.user_enabled only", () => {
		assert.match(visHtml, /KI benutzen/);
		assert.match(visHtml, /data-ems-action="ai-user-enabled"/);
		assert.match(visHtml, /function setAiUserEnabled/);
		assert.match(visHtml, /setVisState\(INST\+"\.ai\.user_enabled",!!on\)/);
		assert.match(visHtml, /g\("ai\.user_enabled"\)/);
		assert.equal(visHtml.includes("ai_enabled"), false);
	});
});
