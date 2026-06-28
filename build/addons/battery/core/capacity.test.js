"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const capacity_js_1 = require("./capacity.js");
(0, node_test_1.describe)("battery capacity", () => {
    (0, node_test_1.it)("manual value used when source manual", () => {
        const r = (0, capacity_js_1.resolveCapacity)({ source: "manual", manualKwh: 10, mappedKwh: 7 });
        strict_1.default.equal(r.effectiveKwh, 10);
        strict_1.default.equal(r.source, "manual");
        strict_1.default.equal(r.valid, true);
    });
    (0, node_test_1.it)("mapped value preferred when source mapped and valid", () => {
        const r = (0, capacity_js_1.resolveCapacity)({ source: "mapped", manualKwh: 10, mappedKwh: 7 });
        strict_1.default.equal(r.effectiveKwh, 7);
        strict_1.default.equal(r.source, "mapped");
    });
    (0, node_test_1.it)("falls back to manual when mapped invalid", () => {
        const r = (0, capacity_js_1.resolveCapacity)({ source: "mapped", manualKwh: 10, mappedKwh: 0 });
        strict_1.default.equal(r.effectiveKwh, 10);
        strict_1.default.equal(r.source, "manual");
    });
    (0, node_test_1.it)("invalid values rejected (null/NaN/Infinity/<=0)", () => {
        for (const bad of [null, NaN, Infinity, 0, -5]) {
            strict_1.default.equal((0, capacity_js_1.isValidCapacityKwh)(bad), false);
        }
        const r = (0, capacity_js_1.resolveCapacity)({ source: "manual", manualKwh: -1, mappedKwh: null });
        strict_1.default.equal(r.valid, false);
        strict_1.default.equal(r.effectiveKwh, null);
        strict_1.default.equal(r.source, "unknown");
    });
    (0, node_test_1.it)("missing capacity never treated as 0", () => {
        const e = (0, capacity_js_1.deriveEnergy)(50, null, 5);
        strict_1.default.equal(e.energyStoredKwh, null);
        strict_1.default.equal(e.energyFreeToFullKwh, null);
    });
    (0, node_test_1.it)("derives energy only when soc and capacity valid", () => {
        const e = (0, capacity_js_1.deriveEnergy)(50, 10, 5);
        strict_1.default.equal(e.energyStoredKwh, 5);
        strict_1.default.equal(e.energyFreeToFullKwh, 5);
        strict_1.default.equal(e.energyAboveTechnicalMinKwh, 4.5);
    });
});
