"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const ROOT = path.resolve(__dirname, "..", "..", "..");
const html = fs.readFileSync(path.join(ROOT, "vis", "ems-charts.html"), "utf8");
function functionBody(name, nextName) {
    const start = html.indexOf(`function ${name}(`);
    const end = html.indexOf(`function ${nextName}(`, start + 1);
    strict_1.default.ok(start >= 0, `${name} fehlt`);
    strict_1.default.ok(end > start, `${nextName} fehlt hinter ${name}`);
    return html.slice(start, end);
}
(0, node_test_1.describe)("VIS Benutzeroberfläche v0.4.1", () => {
    (0, node_test_1.it)("zeigt standardmäßig zwölf Stunden groß und bietet die Gesamtansicht an", () => {
        strict_1.default.match(html, /var priceWindowMode="focus"/);
        strict_1.default.match(html, /focusStart\+12\*60\*60\*1000/);
        strict_1.default.match(html, />Nächste 12 Stunden</);
        strict_1.default.match(html, />Gesamter verfügbarer Zeitraum</);
        strict_1.default.match(html, /\.ems-price-svg\{width:100%;height:150px/);
    });
    (0, node_test_1.it)("ordnet die Planungsseite zweispaltig an und entfernt technische Shared-Power-Texte", () => {
        strict_1.default.match(html, /class="ems-planning-grid"/);
        strict_1.default.doesNotMatch(html, /Kombination\(en\)/);
        strict_1.default.doesNotMatch(html, /p75=/);
        strict_1.default.doesNotMatch(html, /NICHT ALLOKIERT/);
    });
    (0, node_test_1.it)("zeigt auf jeder steuerbaren Geräteseite den wirksamen Modus", () => {
        for (const call of [
            'addonModeStrip("battery"',
            'addonModeStrip("immersion_heater"',
            'addonModeStrip("air_conditioning"',
            'addonModeStrip("wallbox"',
        ])
            strict_1.default.ok(html.includes(call), `${call} fehlt`);
        strict_1.default.match(html, /LIVE VORBEREITET · GLOBAL DRY-RUN/);
    });
    (0, node_test_1.it)("zeigt Heizstab-Lauf und verbleibende Zeit direkt im aktuellen Zustand", () => {
        const thermal = functionBody("renderThermalPage", "climateLearningRows");
        strict_1.default.match(thermal, /HEIZSTAB LÄUFT/);
        strict_1.default.match(thermal, /NOCH /);
        strict_1.default.match(thermal, /remainingRuntimeLabel/);
    });
    (0, node_test_1.it)("weist Klima-Watt nur dem gemeinsamen Außengerät zu", () => {
        const climate = functionBody("renderClimatePage", "renderWallboxPage");
        strict_1.default.match(climate, /Gemeinsames Außengerät · aktueller Zustand/);
        strict_1.default.match(climate, /Leistungsmessung:/);
        strict_1.default.match(climate, /wird genau einmal gezählt/);
        strict_1.default.doesNotMatch(climate, /\["Leistung",fmtW\(g\(base/);
        strict_1.default.doesNotMatch(climate, /demandModel|bootstrap|p75/);
    });
    (0, node_test_1.it)("priorisiert Ladeziel und echte Ladehoheit vor einer bloßen Tibber-Bereitschaft", () => {
        const view = functionBody("visTibberRewardsView", "visFiniteNumber");
        strict_1.default.ok(view.indexOf("targetReached&&!charging") < view.indexOf("if(active)"));
        strict_1.default.match(view, /LADEZIEL ERREICHT/);
        strict_1.default.match(view, /EMS STEUERT DIE LADUNG/);
        strict_1.default.match(view, /TIBBER GRID REWARDS AKTIV/);
        strict_1.default.doesNotMatch(view, /EVCC AN TIBBER ÜBERGEBEN/);
    });
});
