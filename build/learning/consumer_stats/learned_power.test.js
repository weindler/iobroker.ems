"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const buffer_1 = require("./buffer");
const learned_power_1 = require("./learned_power");
(0, node_test_1.describe)("consumer learned power", () => {
    (0, node_test_1.it)("uses config power when no stats", () => {
        const r = (0, learned_power_1.resolveConsumerEffectivePowerW)(undefined, 650, Date.now());
        strict_1.default.equal(r.powerW, 650);
        strict_1.default.equal(r.source, "config");
    });
    (0, node_test_1.it)("uses median learned power from day records", () => {
        const entry = (0, buffer_1.emptyConsumerEntry)("air_conditioning.unit_2", Date.now());
        const now = Date.now();
        for (let i = 0; i < 4; i++) {
            const d = new Date(now - i * 86_400_000);
            const key = d.toISOString().slice(0, 10);
            entry.days[key] = {
                dateKey: key,
                runtimeSec: 7200,
                energyKwh: 3.6,
                lastTickMs: now,
            };
        }
        const r = (0, learned_power_1.resolveConsumerEffectivePowerW)(entry, 650, now);
        strict_1.default.equal(r.source, "learned");
        strict_1.default.equal(r.powerW, 1800);
    });
});
