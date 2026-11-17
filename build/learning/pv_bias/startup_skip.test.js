"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const index_1 = require("./index");
(0, node_test_1.describe)("isFreshLastRun", () => {
    const now = Date.parse("2026-11-15T08:00:00Z");
    (0, node_test_1.it)("frisch bei jüngerem Lauf", () => {
        strict_1.default.equal((0, index_1.isFreshLastRun)("2026-11-15T06:00:00Z", now), true);
    });
    (0, node_test_1.it)("nicht frisch bei altem Lauf", () => {
        strict_1.default.equal((0, index_1.isFreshLastRun)("2026-11-15T04:00:00Z", now), false);
    });
    (0, node_test_1.it)("nicht frisch bei leerem, ungültigem oder zukünftigem Wert", () => {
        strict_1.default.equal((0, index_1.isFreshLastRun)("", now), false);
        strict_1.default.equal((0, index_1.isFreshLastRun)("kaputt", now), false);
        strict_1.default.equal((0, index_1.isFreshLastRun)(null, now), false);
        strict_1.default.equal((0, index_1.isFreshLastRun)("2026-11-15T09:00:00Z", now), false);
    });
});
(0, node_test_1.describe)("Batterie-Laufzeit im Intervall", () => {
    const now = Date.parse("2026-11-16T22:52:00Z");
    (0, node_test_1.it)("läuft stündlich nicht, aber etwa alle 6 Stunden", () => {
        const maxAge = index_1.BATTERY_RUNTIME_INTERVAL_MIN_AGE_MS;
        strict_1.default.equal((0, index_1.isFreshLastRun)("2026-11-16T21:52:00Z", now, maxAge), true, "nach 1 h noch frisch");
        strict_1.default.equal((0, index_1.isFreshLastRun)("2026-11-16T17:52:00Z", now, maxAge), true, "nach 5 h noch frisch");
        strict_1.default.equal((0, index_1.isFreshLastRun)("2026-11-16T16:52:00Z", now, maxAge), false, "nach 6 h wieder fällig");
        strict_1.default.equal((0, index_1.isFreshLastRun)("2026-11-16T16:52:01Z", now, maxAge), false, "6 h minus Zeitdrift wird nicht übersprungen");
    });
});
(0, node_test_1.describe)("Netzausgleich-Wirtschaft im Intervall", () => {
    const now = Date.parse("2026-11-17T03:19:00Z");
    (0, node_test_1.it)("läuft nicht stündlich, aber nach rund 6 Stunden wieder", () => {
        const maxAge = index_1.GRID_BALANCE_ECONOMICS_INTERVAL_MIN_AGE_MS;
        strict_1.default.equal((0, index_1.isFreshLastRun)("2026-11-17T02:19:00Z", now, maxAge), true);
        strict_1.default.equal((0, index_1.isFreshLastRun)("2026-11-16T21:19:00Z", now, maxAge), false);
    });
});
