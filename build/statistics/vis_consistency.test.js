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
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const root = path.resolve(__dirname, "..", "..");
(0, node_test_1.describe)("Statistik in VIS und Admin", () => {
    (0, node_test_1.it)("zeigt die gemessene Autoenergie in beiden ausgelieferten Ansichten", () => {
        const vis = fs.readFileSync(path.join(root, "vis", "ems-charts.html"), "utf8");
        const admin = fs.readFileSync(path.join(root, "admin", "ems-charts.html"), "utf8");
        strict_1.default.equal(vis, admin);
        strict_1.default.match(vis, /Auto zu Hause geladen.*mob\.homeChargedKwh/);
        strict_1.default.match(vis, /Jetzt: Einspeisung/);
        strict_1.default.match(vis, /Diese Werte sind Energieflüsse/);
        strict_1.default.match(vis, /Vergleichsmenge \(Tibber\)/);
        strict_1.default.match(vis, /mobilitySavingsHero\(mobP/);
        strict_1.default.match(vis, /vorläufig/);
        strict_1.default.match(vis, /measuredChargesCard\(chargeRuns/);
        strict_1.default.match(vis, /<th>Verbrenner<\/th><th>Unterschied<\/th>/);
    });
});
