"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const charge_source_js_1 = require("./charge_source.js");
(0, node_test_1.describe)("charge source", () => {
    (0, node_test_1.it)("markiert EMS-Netzladen explizit als grid", () => {
        strict_1.default.equal((0, charge_source_js_1.classifyChargeSource)({
            chargingW: 2000,
            pvW: 500,
            houseW: 400,
            gridImportW: 0,
            emsGridChargeActive: true,
        }), "grid");
    });
    (0, node_test_1.it)("markiert eindeutigen Surplus ohne Import als pv", () => {
        strict_1.default.equal((0, charge_source_js_1.classifyChargeSource)({
            chargingW: 1500,
            pvW: 3000,
            houseW: 800,
            gridImportW: 10,
            emsGridChargeActive: false,
        }), "pv");
    });
    (0, node_test_1.it)("lässt Mischlagen unknown/mixed", () => {
        strict_1.default.equal((0, charge_source_js_1.classifyChargeSource)({
            chargingW: 800,
            pvW: 900,
            houseW: 700,
            gridImportW: 400,
            emsGridChargeActive: false,
        }), "mixed");
        strict_1.default.equal((0, charge_source_js_1.classifyChargeSource)({
            chargingW: 100,
            pvW: null,
            houseW: null,
            gridImportW: null,
            emsGridChargeActive: false,
        }), "unknown");
    });
    (0, node_test_1.it)("merged Slot-Konflikte zu mixed", () => {
        strict_1.default.equal((0, charge_source_js_1.mergeChargeSource)("pv", "grid"), "mixed");
        strict_1.default.equal((0, charge_source_js_1.mergeChargeSource)("unknown", "pv"), "pv");
        strict_1.default.equal((0, charge_source_js_1.mergeChargeSource)("pv", "unknown"), "pv");
    });
});
