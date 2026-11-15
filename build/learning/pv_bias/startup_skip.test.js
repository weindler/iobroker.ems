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
