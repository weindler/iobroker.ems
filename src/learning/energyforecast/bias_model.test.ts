import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BIAS_MAX_CT, biasDaysAvailable, dayTypeOf, estimateBiasCt, mergeBiasHistory, type DayHourBias } from "./bias_model";

function entry(date: string, bias: number, lead = 1): DayHourBias {
	return { date, lead, dayType: dayTypeOf(date), hours: [{ hour: 12, biasCt: bias, n: 4 }] };
}

describe("Energyforecast Verzerrungsmodell", () => {
	it("erkennt Tagestypen", () => {
		assert.equal(dayTypeOf("2026-11-14"), "samstag");
		assert.equal(dayTypeOf("2026-11-15"), "sonntag");
		assert.equal(dayTypeOf("2026-11-16"), "werktag");
	});

	it("korrigiert nicht, solange zu wenig Tage verglichen wurden", () => {
		const h = [entry("2026-11-15", 6), entry("2026-11-16", 5), entry("2026-11-17", 5)];
		assert.equal(estimateBiasCt(h, 12, "werktag", 1), null);
		assert.equal(biasDaysAvailable(h, 1), 3);
	});

	it("nutzt Gesamtmittel, wenn der Tagestyp noch keine Daten hat", () => {
		const h = [entry("2026-11-16", 4), entry("2026-11-17", 4), entry("2026-11-18", 4), entry("2026-11-19", 4)];
		assert.equal(estimateBiasCt(h, 12, "sonntag", 1), 4);
	});

	it("gewichtet den Tagestyp, ohne das Gesamtmittel zu ignorieren", () => {
		const h = [
			entry("2026-11-16", 2),
			entry("2026-11-17", 2),
			entry("2026-11-18", 2),
			entry("2026-11-15", 8), // Sonntag
		];
		const all = (2 + 2 + 2 + 8) / 4; // 3,5
		const est = estimateBiasCt(h, 12, "sonntag", 1) as number;
		// (1 Sonntag * 8 + 3 * 3,5) / 4 = 4,625 → zwischen Gesamtmittel und Sonntagswert
		assert.ok(est > all && est < 8);
		assert.ok(Math.abs(est - 4.625) <= 0.006);
	});

	it("begrenzt den Abzug", () => {
		const h = [1, 2, 3, 4].map((d) => entry(`2026-11-0${d}`, 40));
		assert.equal(estimateBiasCt(h, 12, "werktag", 1), BIAS_MAX_CT);
	});

	it("trennt Vorlaufgruppen und entfernt Altes", () => {
		const now = Date.parse("2026-11-20T00:00:00Z");
		const merged = mergeBiasHistory([entry("2026-01-01", 1)], [entry("2026-11-15", 5, 1), entry("2026-11-15", 6, 2)], now);
		assert.equal(merged.length, 2);
		assert.equal(biasDaysAvailable(merged, 1), 1);
	});
});
