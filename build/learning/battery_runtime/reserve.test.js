"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const reserve_js_1 = require("./reserve.js");
(0, node_test_1.describe)("dynamic battery reserve (Phase 1d)", () => {
    (0, node_test_1.it)("derives requiredSocAtPvEndPct from predicted night consumption + capacity + margin", () => {
        const r = (0, reserve_js_1.resolveRequiredSocAtPvEndPct)({
            predictedNightConsumptionKwh: 5,
            usableCapacityKwh: 20,
        });
        // 5 * 1.2 = 6 kWh; 6/20*100 = 30 %.
        strict_1.default.equal(r.requiredReserveKwh, 6);
        strict_1.default.equal(r.requiredSocAtPvEndPct, 30);
        strict_1.default.match(r.reasonDe, /Reserve 6\.0 kWh \(30 %\)/);
    });
    (0, node_test_1.it)("respects a custom safety margin", () => {
        const r = (0, reserve_js_1.resolveRequiredSocAtPvEndPct)({
            predictedNightConsumptionKwh: 10,
            usableCapacityKwh: 20,
            safetyMarginFraction: 0.5,
        });
        // 10 * 1.5 = 15 kWh; 15/20*100 = 75 %.
        strict_1.default.equal(r.requiredReserveKwh, 15);
        strict_1.default.equal(r.requiredSocAtPvEndPct, 75);
    });
    (0, node_test_1.it)("clamps to 100 % when required reserve exceeds capacity", () => {
        const r = (0, reserve_js_1.resolveRequiredSocAtPvEndPct)({
            predictedNightConsumptionKwh: 50,
            usableCapacityKwh: 10,
        });
        strict_1.default.equal(r.requiredSocAtPvEndPct, 100);
        strict_1.default.equal(r.requiredReserveKwh, 10);
        strict_1.default.match(r.reasonDe, /Kapazität/);
    });
    (0, node_test_1.it)("returns null (no hidden fixed fallback) when night consumption is unknown", () => {
        const r = (0, reserve_js_1.resolveRequiredSocAtPvEndPct)({
            predictedNightConsumptionKwh: null,
            usableCapacityKwh: 20,
        });
        strict_1.default.equal(r.requiredSocAtPvEndPct, null);
        strict_1.default.equal(r.requiredReserveKwh, null);
        strict_1.default.match(r.reasonDe, /Nachtverbrauch/);
    });
    (0, node_test_1.it)("returns null when usable capacity is unknown", () => {
        const r = (0, reserve_js_1.resolveRequiredSocAtPvEndPct)({
            predictedNightConsumptionKwh: 5,
            usableCapacityKwh: null,
        });
        strict_1.default.equal(r.requiredSocAtPvEndPct, null);
        strict_1.default.match(r.reasonDe, /[Kk]apazität/);
    });
    (0, node_test_1.it)("returns null when usable capacity is zero/negative", () => {
        const r = (0, reserve_js_1.resolveRequiredSocAtPvEndPct)({
            predictedNightConsumptionKwh: 5,
            usableCapacityKwh: 0,
        });
        strict_1.default.equal(r.requiredSocAtPvEndPct, null);
    });
    (0, node_test_1.it)("treats zero predicted consumption as valid (no reserve needed), not as unknown", () => {
        const r = (0, reserve_js_1.resolveRequiredSocAtPvEndPct)({
            predictedNightConsumptionKwh: 0,
            usableCapacityKwh: 20,
        });
        strict_1.default.equal(r.requiredSocAtPvEndPct, 0);
        strict_1.default.equal(r.requiredReserveKwh, 0);
    });
    (0, node_test_1.it)("exports the default margin as a named, documented constant (not hidden)", () => {
        strict_1.default.equal(reserve_js_1.NIGHT_RESERVE_SAFETY_MARGIN_FRACTION, 0.2);
    });
});
