import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(__dirname, "..", "..");

describe("Statistik in VIS und Admin", () => {
	it("zeigt die gemessene Autoenergie in beiden ausgelieferten Ansichten", () => {
		const vis = fs.readFileSync(path.join(root, "vis", "ems-charts.html"), "utf8");
		const admin = fs.readFileSync(path.join(root, "admin", "ems-charts.html"), "utf8");
		assert.equal(vis, admin);
		assert.match(vis, /Auto zu Hause geladen.*mob\.homeChargedKwh/);
		assert.match(vis, /Jetzt: Einspeisung/);
		assert.match(vis, /Diese Werte sind Energieflüsse/);
		assert.match(vis, /Vergleichsmenge \(Tibber\)/);
		assert.match(vis, /mobilitySavingsHero\(mobP/);
		assert.match(vis, /vorläufig/);
		assert.match(vis, /measuredChargesCard\(chargeRuns/);
		assert.match(vis, /<th>Verbrenner<\/th><th>Unterschied<\/th>/);
		assert.match(vis, /monthlyOverviewCard\(monthRows/);
		assert.match(vis, /data-ems-action="stats-month-select"/);
	});
});
