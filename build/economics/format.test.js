"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const format_js_1 = require("./format.js");
(0, node_test_1.describe)("economics format", () => {
    (0, node_test_1.it)("positiv = gespart, negativ = Mehrkosten, ohne Schönrechnung", () => {
        strict_1.default.equal((0, format_js_1.formatEmsAdvantagePhraseDe)(0.14), "EMS hat 0,14 € gespart");
        strict_1.default.equal((0, format_js_1.formatEmsAdvantagePhraseDe)(-0.14), "EMS verursachte 0,14 € Mehrkosten");
        strict_1.default.equal((0, format_js_1.formatEmsAdvantagePhraseDe)(0), "EMS hat weder gespart noch Mehrkosten verursacht");
        strict_1.default.equal((0, format_js_1.formatEmsAdvantagePhraseDe)(null), "EMS-Effekt nicht bewertbar");
    });
    (0, node_test_1.it)("Netto-Kosten negativ als Ertrag, positiv als Kosten", () => {
        strict_1.default.equal((0, format_js_1.formatNetCostPhraseDe)(-1.95, "Mit EMS"), "Mit EMS: 1,95 € Ertrag");
        strict_1.default.equal((0, format_js_1.formatNetCostPhraseDe)(2.09, "Ohne EMS"), "Ohne EMS: 2,09 € Kosten");
        strict_1.default.equal((0, format_js_1.formatNetCostPhraseDe)(null, "Mit EMS"), "Mit EMS: —");
    });
});
