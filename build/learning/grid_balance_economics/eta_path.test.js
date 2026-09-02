"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const eta_path_js_1 = require("./eta_path.js");
const constants_js_1 = require("./constants.js");
(0, node_test_1.describe)("eta path", () => {
    (0, node_test_1.it)("nutzt 92 % Fallback ohne Sessions", () => {
        const r = (0, eta_path_js_1.learnEtaPaths)([]);
        strict_1.default.equal(r.etaPvUsable, false);
        strict_1.default.equal(r.etaGridUsable, false);
        strict_1.default.equal((0, eta_path_js_1.etaForPath)(r, "pv"), constants_js_1.ETA_PATH_FALLBACK);
    });
    (0, node_test_1.it)("lernt nur aus eindeutigen Pfaden, nicht aus Tagesquotienten", () => {
        const sessions = Array.from({ length: 5 }, () => ({
            source: "pv",
            chargeKwh: 4,
            dischargeKwh: 3.4,
        }));
        const r = (0, eta_path_js_1.learnEtaPaths)(sessions);
        strict_1.default.equal(r.etaPvUsable, true);
        strict_1.default.ok(r.etaPvPath != null && r.etaPvPath > 0.8 && r.etaPvPath < 0.9);
    });
    (0, node_test_1.it)("bricht Sessions bei mixed/unknown ab", () => {
        const s = (0, eta_path_js_1.sessionsFromChargeSlots)({
            chargedKwh: [2, 2, 0, 0],
            dischargedKwh: [0, 0, 1.5, 1.5],
            source: ["pv", "mixed", "unknown", "unknown"],
        });
        strict_1.default.equal(s.length, 0);
    });
});
