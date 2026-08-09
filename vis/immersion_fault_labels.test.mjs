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
});
