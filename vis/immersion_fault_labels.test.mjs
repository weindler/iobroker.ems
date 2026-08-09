/**
 * VIS-Regression: Heizstab Fault/Lockout-Darstellung in ems-charts.html.
 * Keine Runtime-Logik — nur Produkttexte und Helper-Präsenz.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const visHtml = readFileSync(join(dir, "ems-charts.html"), "utf8");
const adminHtml = readFileSync(join(dir, "..", "admin", "ems-charts.html"), "utf8");

const FAULT_LABELS = {
	no_power_when_on: "Keine Leistung nach Einschaltbefehl",
	power_when_off: "Leistung trotz Ausschaltbefehl",
	power_mismatch: "Leistung weicht von der Nennleistung ab",
	relay_chatter: "Relais schaltet zu häufig",
	write_failed: "Schaltbefehl fehlgeschlagen",
	feedback_mismatch: "Rückmeldung stimmt nicht überein",
	invalid_configuration: "Konfiguration ungültig",
	temperature_missing: "Puffertemperatur fehlt",
	temperature_stale: "Puffertemperatur veraltet",
	temperature_implausible: "Puffertemperatur unplausibel",
};

describe("VIS immersion fault/lockout display", () => {
	it("vis and admin ems-charts.html stay in sync", () => {
		assert.equal(visHtml, adminHtml);
	});

	it("subscribes to existing fault runtime states", () => {
		assert.match(visHtml, /runtime\.fault_active/);
		assert.match(visHtml, /runtime\.fault_code/);
		assert.match(visHtml, /runtime\.fault_message/);
	});

	it("maps fault codes to German product labels", () => {
		for (const [code, de] of Object.entries(FAULT_LABELS)) {
			assert.match(visHtml, new RegExp(code + ':"' + de.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"'));
		}
	});

	it("prioritizes FEHLER/LOCKOUT badges over Aus", () => {
		assert.match(visHtml, /function immersionFaultOpBadge/);
		assert.match(visHtml, /label:"LOCKOUT"/);
		assert.match(visHtml, /label:"FEHLER"/);
		assert.match(visHtml, /ems-badge\.fault/);
		assert.match(visHtml, /ems-badge\.lockout/);
	});

	it("NOW line distinguishes fault from planmäßig aus", () => {
		assert.match(visHtml, /Heizstab gesperrt \(Lockout\)/);
		assert.match(visHtml, /Heizstab FEHLER/);
		assert.match(visHtml, /immersionFaultActive\(\).*Heizstab/s);
	});

	it("agenda shows short fault lock hint", () => {
		assert.match(visHtml, /Heizstab wegen Gerätestörung gesperrt/);
		assert.match(visHtml, /status==="fault"/);
	});

	it("G-A) reset button only via immersionFaultResetActionsHtml when fault active", () => {
		assert.match(visHtml, /function immersionFaultResetActionsHtml/);
		assert.match(visHtml, /if\(!immersionFaultActive\(\)\)return ""/);
		assert.match(visHtml, /immersionFaultResetActionsHtml\(\)/);
	});

	it("G-B) fault UI offers Fehler zurücksetzen", () => {
		assert.match(visHtml, />Fehler zurücksetzen</);
		assert.match(visHtml, /data-ems-action="ih-fault-reset"/);
	});

	it("G-C) button writes only fault_reset=true", () => {
		const fn = visHtml.match(
			/function requestImmersionFaultReset\(\)\{[\s\S]*?\n\}/,
		)?.[0];
		assert.ok(fn);
		assert.match(
			fn,
			/setVisState\(INST\+"\.addons\.immersion_heater\.runtime\.fault_reset",true\)/,
		);
		assert.equal(fn.includes("fault_active"), false);
		assert.equal(fn.includes("commanded_stage"), false);
		assert.equal(fn.includes("fault_code"), false);
		assert.equal([...fn.matchAll(/setVisState\(/g)].length, 1);
	});

	it("G-D/E) soft hint from existing states; backend canResetFault remains authority", () => {
		assert.match(visHtml, /function immersionFaultResetSoftBlocked/);
		assert.match(visHtml, /Reset erst möglich, wenn Relais\/Stufe aus ist/);
		assert.match(visHtml, /keine Leistung mehr gemessen wird/);
		assert.match(visHtml, /runtime\.fault_reset/);
	});

	it("G-F) reset copy does not claim immediate heater ON", () => {
		assert.match(visHtml, /Einschalten entscheidet danach der normale Plan/);
		assert.equal(/Heizstab jetzt einschalten/i.test(visHtml), false);
	});

	it("G-G) no_power_when_on product label preserved", () => {
		assert.match(visHtml, /no_power_when_on:"Keine Leistung nach Einschaltbefehl"/);
		assert.match(visHtml, /Sicherheits-Lockout aktiv/);
	});
});
