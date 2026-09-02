"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const stability_js_1 = require("./stability.js");
(0, node_test_1.describe)("GB economics stability", () => {
    (0, node_test_1.it)("braucht mehrere ruhige Messungen", () => {
        strict_1.default.equal((0, stability_js_1.isStabilityWindowStable)([
            { houseW: 400, pvW: 0, gridW: 30, gbEffectiveW: 50 },
            { houseW: 410, pvW: 0, gridW: 28, gbEffectiveW: 52 },
        ]), false);
    });
    (0, node_test_1.it)("erkennt stabile Nachtlast relativ + mit Mindesttoleranz", () => {
        strict_1.default.equal((0, stability_js_1.isStabilityWindowStable)([
            { houseW: 380, pvW: 0, gridW: 25, gbEffectiveW: 50 },
            { houseW: 400, pvW: 0, gridW: 30, gbEffectiveW: 48 },
            { houseW: 390, pvW: 0, gridW: 22, gbEffectiveW: 55 },
        ]), true);
    });
    (0, node_test_1.it)("wird bei Lastsprung unstable", () => {
        strict_1.default.equal((0, stability_js_1.isStabilityWindowStable)([
            { houseW: 400, pvW: 0, gridW: 30, gbEffectiveW: 50 },
            { houseW: 420, pvW: 0, gridW: 28, gbEffectiveW: 52 },
            { houseW: 2200, pvW: 0, gridW: 1800, gbEffectiveW: 400 },
        ]), false);
    });
    (0, node_test_1.it)("erfindet fehlende Hauslast nicht als 0", () => {
        strict_1.default.equal((0, stability_js_1.isStabilityWindowStable)([
            { houseW: null, pvW: 0, gridW: 30, gbEffectiveW: 50 },
            { houseW: null, pvW: 0, gridW: 28, gbEffectiveW: 52 },
            { houseW: null, pvW: 0, gridW: 22, gbEffectiveW: 55 },
        ]), false);
    });
});
