"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const thermal_soft_urgency_js_1 = require("./thermal_soft_urgency.js");
const NOW = Date.parse("2026-09-01T10:00:00.000Z");
(0, node_test_1.describe)("resolveThermalSoftUrgency", () => {
    (0, node_test_1.it)("unbekannte Reichweite ändert Soft nicht (kein Skip)", () => {
        const u = (0, thermal_soft_urgency_js_1.resolveThermalSoftUrgency)({ nowMs: NOW, emptyMs: null, nextReliablePvMs: NOW + 8 * 3600_000 });
        strict_1.default.equal(u.skipWeakSoftWindows, false);
        strict_1.default.equal(u.requireCoherentBlock, false);
        strict_1.default.equal(u.needScale, 0);
    });
    (0, node_test_1.it)("Overnight-Lücke bleibt dringlich", () => {
        const empty = NOW + 4 * 3600_000;
        const rec = NOW + 14 * 3600_000;
        const u = (0, thermal_soft_urgency_js_1.resolveThermalSoftUrgency)({ nowMs: NOW, emptyMs: empty, nextReliablePvMs: rec });
        strict_1.default.ok(u.needScale > 0.9, `needScale=${u.needScale}`);
        strict_1.default.equal(u.skipWeakSoftWindows, false);
    });
    (0, node_test_1.it)("60 h Reichweite → keine Soft-Dringlichkeit, schwache Fenster weglassen", () => {
        const empty = NOW + 60 * 3600_000;
        const rec = NOW + 12 * 3600_000;
        const u = (0, thermal_soft_urgency_js_1.resolveThermalSoftUrgency)({ nowMs: NOW, emptyMs: empty, nextReliablePvMs: rec });
        strict_1.default.equal(u.needScale, 0);
        strict_1.default.equal(u.skipWeakSoftWindows, true);
        strict_1.default.equal(u.requireCoherentBlock, true);
    });
    (0, node_test_1.it)("knapp über nächstem PV bleibt etwas Soft-Nutzen", () => {
        const empty = NOW + 10 * 3600_000;
        const rec = NOW + 8 * 3600_000;
        const u = (0, thermal_soft_urgency_js_1.resolveThermalSoftUrgency)({ nowMs: NOW, emptyMs: empty, nextReliablePvMs: rec });
        strict_1.default.ok(u.needScale > 0.6, `needScale=${u.needScale}`);
        strict_1.default.equal(u.skipWeakSoftWindows, false);
    });
});
