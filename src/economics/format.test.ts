import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatEmsAdvantagePhraseDe, formatNetCostPhraseDe } from "./format.js";

describe("economics format", () => {
	it("positiv = gespart, negativ = Mehrkosten, ohne Schönrechnung", () => {
		assert.equal(formatEmsAdvantagePhraseDe(0.14), "EMS hat 0,14 € gespart");
		assert.equal(formatEmsAdvantagePhraseDe(-0.14), "EMS verursachte 0,14 € Mehrkosten");
		assert.equal(formatEmsAdvantagePhraseDe(0), "EMS hat weder gespart noch Mehrkosten verursacht");
		assert.equal(formatEmsAdvantagePhraseDe(null), "EMS-Effekt nicht bewertbar");
	});

	it("Netto-Kosten negativ als Ertrag, positiv als Kosten", () => {
		assert.equal(formatNetCostPhraseDe(-1.95, "Mit EMS"), "Mit EMS: 1,95 € Ertrag");
		assert.equal(formatNetCostPhraseDe(2.09, "Ohne EMS"), "Ohne EMS: 2,09 € Kosten");
		assert.equal(formatNetCostPhraseDe(null, "Mit EMS"), "Mit EMS: —");
	});
});
