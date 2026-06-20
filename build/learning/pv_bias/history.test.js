"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const history_1 = require("./history");
(0, node_test_1.describe)("pv_bias history ids", () => {
    (0, node_test_1.it)("detects foreign ioBroker state ids", () => {
        strict_1.default.equal((0, history_1.isForeignStateId)("alias.0.PV.WR.Fronius.DAY_ENERGY"), true);
        strict_1.default.equal((0, history_1.isForeignStateId)("pvforecast.0.summary.energy.today"), true);
    });
    (0, node_test_1.it)("treats relative ems states as own", () => {
        strict_1.default.equal((0, history_1.isForeignStateId)("learning.pv_bias.frozen_today_kwh"), false);
    });
});
