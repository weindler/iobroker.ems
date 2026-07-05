"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const stats_active_1 = require("./stats_active");
const persist_1 = require("./persist");
(0, node_test_1.describe)("acStatsDeviceActive", () => {
    (0, node_test_1.it)("counts after live start while feedback is still off", () => {
        const up = (0, persist_1.emptyUnitPersist)(2);
        up.lastStartAtMs = 1000;
        strict_1.default.equal((0, stats_active_1.acStatsDeviceActive)(up, false, false), true);
    });
    (0, node_test_1.it)("counts in dryrun while EMS session is open and feedback is off", () => {
        const up = (0, persist_1.emptyUnitPersist)(2);
        up.lastStartAtMs = 1000;
        up.running = true;
        strict_1.default.equal((0, stats_active_1.acStatsDeviceActive)(up, false, true), true);
    });
    (0, node_test_1.it)("stops counting after stop was confirmed", () => {
        const up = (0, persist_1.emptyUnitPersist)(2);
        up.lastStartAtMs = 1000;
        up.lastStopAtMs = 2000;
        strict_1.default.equal((0, stats_active_1.acStatsDeviceActive)(up, false, false), false);
    });
    (0, node_test_1.it)("counts when feedback is on regardless of stop timestamps", () => {
        const up = (0, persist_1.emptyUnitPersist)(2);
        up.lastStartAtMs = 1000;
        up.lastStopAtMs = 2000;
        strict_1.default.equal((0, stats_active_1.acStatsDeviceActive)(up, true, false), true);
    });
});
