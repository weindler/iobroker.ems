"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const evcc_output_1 = require("./evcc_output");
(0, node_test_1.describe)("evcc-Batteriemodus", () => {
    (0, node_test_1.it)("Netzladen → charge, Hold/Reserve → hold, sonst nichts", () => {
        strict_1.default.equal((0, evcc_output_1.decideEvccBatteryMode)({ intent: { action: "grid_charge", energySource: "grid" }, externalAuthority: false }).mode, "charge");
        strict_1.default.equal((0, evcc_output_1.decideEvccBatteryMode)({ intent: { action: "charge", energySource: "grid" }, externalAuthority: false }).mode, "charge");
        strict_1.default.equal((0, evcc_output_1.decideEvccBatteryMode)({ intent: { action: "charge", energySource: "pv" }, externalAuthority: false }).mode, null);
        strict_1.default.equal((0, evcc_output_1.decideEvccBatteryMode)({ intent: { action: "hold", energySource: "unknown" }, externalAuthority: false }).mode, "hold");
        strict_1.default.equal((0, evcc_output_1.decideEvccBatteryMode)({ intent: { action: "protect_reserve", energySource: "unknown" }, externalAuthority: false }).mode, "hold");
        strict_1.default.equal((0, evcc_output_1.decideEvccBatteryMode)({ intent: { action: "self_consumption", energySource: "unknown" }, externalAuthority: false }).mode, null);
    });
    (0, node_test_1.it)("externe Steuerung (Tibber/evcc) → EMS schreibt nichts", () => {
        const d = (0, evcc_output_1.decideEvccBatteryMode)({ intent: { action: "hold", energySource: "unknown" }, externalAuthority: true });
        strict_1.default.equal(d.mode, null);
    });
    (0, node_test_1.it)("Änderung sofort, gleicher Modus nur als Keepalive, Freigabe einmalig", () => {
        let st = evcc_output_1.EVCC_OUTPUT_INITIAL;
        let r = (0, evcc_output_1.planEvccOutputStep)("hold", st, 1_000);
        strict_1.default.equal(r.write, "hold");
        st = r.next;
        r = (0, evcc_output_1.planEvccOutputStep)("hold", st, 1_000 + evcc_output_1.EVCC_MODE_KEEPALIVE_MS - 1);
        strict_1.default.equal(r.write, null);
        r = (0, evcc_output_1.planEvccOutputStep)("hold", st, 1_000 + evcc_output_1.EVCC_MODE_KEEPALIVE_MS);
        strict_1.default.equal(r.write, "hold");
        st = r.next;
        r = (0, evcc_output_1.planEvccOutputStep)(null, st, 100_000);
        strict_1.default.equal(r.write, "normal");
        st = r.next;
        r = (0, evcc_output_1.planEvccOutputStep)(null, st, 110_000);
        strict_1.default.equal(r.write, null);
    });
    (0, node_test_1.it)("nie geschrieben und nichts gewünscht → nichts", () => {
        strict_1.default.equal((0, evcc_output_1.planEvccOutputStep)(null, evcc_output_1.EVCC_OUTPUT_INITIAL, 5).write, null);
    });
});
