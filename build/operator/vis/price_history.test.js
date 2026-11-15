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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("node:assert/strict"));
const node_test_1 = require("node:test");
const price_history_1 = require("./price_history");
(0, node_test_1.describe)("price_history", () => {
    const now = Date.UTC(2026, 10, 15, 10, 0, 0);
    (0, node_test_1.it)("mischt neue Preise ein und meldet changed", () => {
        const r = (0, price_history_1.mergePriceHistory)((0, price_history_1.emptyPriceHistory)(), now, [[now - 3_600_000, 27.5]]);
        assert.equal(r.changed, true);
        assert.equal(r.history.a[String(now - 3_600_000)], 27.5);
    });
    (0, node_test_1.it)("gleiche Werte ändern nichts", () => {
        const r1 = (0, price_history_1.mergePriceHistory)((0, price_history_1.emptyPriceHistory)(), now, [[now - 900_000, 30]]);
        const r2 = (0, price_history_1.mergePriceHistory)(r1.history, now, [[now - 900_000, 30]]);
        assert.equal(r2.changed, false);
    });
    (0, node_test_1.it)("verwirft Älteres als 72 h und ignoriert ungültige Werte", () => {
        const old = now - price_history_1.PRICE_HISTORY_KEEP_MS - 1000;
        const r = (0, price_history_1.mergePriceHistory)({ version: 1, a: { [String(old)]: 20 } }, now, [[NaN, 1], [now, Number.NaN]]);
        assert.equal(r.changed, true);
        assert.deepEqual(r.history.a, {});
    });
});
