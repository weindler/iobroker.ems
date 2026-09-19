import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const html = fs.readFileSync(path.join(ROOT, "vis", "ems-charts.html"), "utf8");

function functionBody(name: string, nextName: string): string {
	const start = html.indexOf(`function ${name}(`);
	const end = html.indexOf(`function ${nextName}(`, start + 1);
	assert.ok(start >= 0, `${name} fehlt`);
	assert.ok(end > start, `${nextName} fehlt hinter ${name}`);
	return html.slice(start, end);
}

describe("VIS Benutzeroberfläche v0.4.1", () => {
	it("zeigt standardmäßig zwölf Stunden groß und bietet die Gesamtansicht an", () => {
		assert.match(html, /var priceWindowMode="focus"/);
		assert.match(html, /focusStart\+12\*60\*60\*1000/);
		assert.match(html, />Nächste 12 Stunden</);
		assert.match(html, />Gesamter verfügbarer Zeitraum</);
		assert.match(html, /\.ems-price-svg\{width:100%;height:150px/);
	});

	it("ordnet die Planungsseite zweispaltig an und entfernt technische Shared-Power-Texte", () => {
		assert.match(html, /class="ems-planning-grid"/);
		assert.doesNotMatch(html, /Kombination\(en\)/);
		assert.doesNotMatch(html, /p75=/);
		assert.doesNotMatch(html, /NICHT ALLOKIERT/);
	});

	it("zeigt auf jeder steuerbaren Geräteseite den wirksamen Modus", () => {
		for (const call of [
			'addonModeStrip("battery"',
			'addonModeStrip("immersion_heater"',
			'addonModeStrip("air_conditioning"',
			'addonModeStrip("wallbox"',
		]) assert.ok(html.includes(call), `${call} fehlt`);
		assert.match(html, /LIVE VORBEREITET · GLOBAL DRY-RUN/);
	});

	it("zeigt Heizstab-Lauf und verbleibende Zeit direkt im aktuellen Zustand", () => {
		const thermal = functionBody("renderThermalPage", "climateLearningRows");
		assert.match(thermal, /HEIZSTAB LÄUFT/);
		assert.match(thermal, /NOCH /);
		assert.match(thermal, /remainingRuntimeLabel/);
	});

	it("weist Klima-Watt nur dem gemeinsamen Außengerät zu", () => {
		const climate = functionBody("renderClimatePage", "renderWallboxPage");
		assert.match(climate, /Gemeinsames Außengerät · aktueller Zustand/);
		assert.match(climate, /Leistungsmessung:/);
		assert.match(climate, /wird genau einmal gezählt/);
		assert.doesNotMatch(climate, /\["Leistung",fmtW\(g\(base/);
		assert.doesNotMatch(climate, /demandModel|bootstrap|p75/);
	});

	it("priorisiert Ladeziel und echte Ladehoheit vor einer bloßen Tibber-Bereitschaft", () => {
		const view = functionBody("visTibberRewardsView", "visFiniteNumber");
		assert.ok(view.indexOf("targetReached&&!charging") < view.indexOf("if(active)"));
		assert.match(view, /LADEZIEL ERREICHT/);
		assert.match(view, /EMS STEUERT DIE LADUNG/);
		assert.match(view, /TIBBER GRID REWARDS AKTIV/);
		assert.doesNotMatch(view, /EVCC AN TIBBER ÜBERGEBEN/);
	});

	it("zeigt Wallbox-Leistung ohne technisches Vorzeichen als Ladeleistung", () => {
		const timeline = functionBody("buildTimelineRanges", "visLageLine");
		assert.match(timeline, /Math\.abs\(Number\(windowW\)\)/);
		assert.match(timeline, /Ladeleistung/);
	});

	it("zeigt den Klima-Zweck in der Tagesplanung nur bei laufendem Gerät", () => {
		const climate = functionBody("climateTodayLines", "paintEl");
		assert.match(climate, /if\(running&&purpose\)bits\.push\(purpose\)/);
		assert.doesNotMatch(climate, /if\(purpose\)bits\.push\(purpose\)/);
	});
});
