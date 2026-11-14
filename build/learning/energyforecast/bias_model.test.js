"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const bias_model_1 = require("./bias_model");
function entry(date, bias, lead = 1) {
    return { date, lead, dayType: (0, bias_model_1.dayTypeOf)(date), hours: [{ hour: 12, biasCt: bias, n: 4 }] };
}
(0, node_test_1.describe)("Energyforecast Verzerrungsmodell", () => {
    (0, node_test_1.it)("erkennt Tagestypen", () => {
        strict_1.default.equal((0, bias_model_1.dayTypeOf)("2026-11-14"), "samstag");
        strict_1.default.equal((0, bias_model_1.dayTypeOf)("2026-11-15"), "sonntag");
        strict_1.default.equal((0, bias_model_1.dayTypeOf)("2026-11-16"), "werktag");
    });
    (0, node_test_1.it)("korrigiert nicht, solange zu wenig Tage verglichen wurden", () => {
        const h = [entry("2026-11-15", 6), entry("2026-11-16", 5), entry("2026-11-17", 5)];
        strict_1.default.equal((0, bias_model_1.estimateBiasCt)(h, 12, "werktag", 1), null);
        strict_1.default.equal((0, bias_model_1.biasDaysAvailable)(h, 1), 3);
    });
    (0, node_test_1.it)("nutzt Gesamtmittel, wenn der Tagestyp noch keine Daten hat", () => {
        const h = [entry("2026-11-16", 4), entry("2026-11-17", 4), entry("2026-11-18", 4), entry("2026-11-19", 4)];
        strict_1.default.equal((0, bias_model_1.estimateBiasCt)(h, 12, "sonntag", 1), 4);
    });
    (0, node_test_1.it)("gewichtet den Tagestyp, ohne das Gesamtmittel zu ignorieren", () => {
        const h = [
            entry("2026-11-16", 2),
            entry("2026-11-17", 2),
            entry("2026-11-18", 2),
            entry("2026-11-15", 8), // Sonntag
        ];
        const all = (2 + 2 + 2 + 8) / 4; // 3,5
        const est = (0, bias_model_1.estimateBiasCt)(h, 12, "sonntag", 1);
        // (1 Sonntag * 8 + 3 * 3,5) / 4 = 4,625 → zwischen Gesamtmittel und Sonntagswert
        strict_1.default.ok(est > all && est < 8);
        strict_1.default.ok(Math.abs(est - 4.625) <= 0.006);
    });
    (0, node_test_1.it)("begrenzt den Abzug", () => {
        const h = [1, 2, 3, 4].map((d) => entry(`2026-11-0${d}`, 40));
        strict_1.default.equal((0, bias_model_1.estimateBiasCt)(h, 12, "werktag", 1), bias_model_1.BIAS_MAX_CT);
    });
    (0, node_test_1.it)("trennt Vorlaufgruppen und entfernt Altes", () => {
        const now = Date.parse("2026-11-20T00:00:00Z");
        const merged = (0, bias_model_1.mergeBiasHistory)([entry("2026-01-01", 1)], [entry("2026-11-15", 5, 1), entry("2026-11-15", 6, 2)], now);
        strict_1.default.equal(merged.length, 2);
        strict_1.default.equal((0, bias_model_1.biasDaysAvailable)(merged, 1), 1);
    });
});
