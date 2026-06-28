"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const resolve_js_1 = require("./resolve.js");
const NOW = new Date("2026-06-27T12:00:00Z");
const ISO = NOW.toISOString();
function evccField(value, status = "valid") {
    return {
        value,
        status,
        origin: { source: "evcc", owner: "evcc", change_kind: "unknown" },
        observed_at: ISO,
    };
}
function iobrokerField(value) {
    return {
        value,
        status: "valid",
        origin: {
            source: "iobroker",
            owner: "user",
            change_kind: "manual_explicit",
        },
        observed_at: ISO,
        changed_at: ISO,
    };
}
function evccSnapshot(strategy) {
    return {
        observed_at: ISO,
        charge_strategy: evccField(strategy),
        target_soc_pct: evccField(null, "missing"),
        deadline: evccField(null, "missing"),
        status: "ok",
    };
}
(0, node_test_1.describe)("wallbox intent resolver", () => {
    (0, node_test_1.it)("iobroker beats evcc", () => {
        const evcc = evccSnapshot("pv");
        const iobroker = {
            observed_at: ISO,
            charge_strategy: iobrokerField("immediate"),
            target_soc_pct: null,
            deadline: null,
            manual_override: null,
            request_id: "r1",
        };
        const r = (0, resolve_js_1.resolveWallboxIntent)({ now: NOW, previous: null, evcc, iobroker, admin: null, override: null, active: true });
        strict_1.default.equal(r.charge_strategy.value, "immediate");
        strict_1.default.equal(r.charge_strategy.origin.source, "iobroker");
    });
    (0, node_test_1.it)("evcc beats admin default", () => {
        const evcc = evccSnapshot("min_pv");
        const admin = {
            observed_at: ISO,
            charge_strategy: {
                value: "pv",
                status: "valid",
                origin: { source: "admin", owner: "admin_config", change_kind: "configured" },
                observed_at: ISO,
            },
            target_soc_pct: null,
            timezone: "Europe/Berlin",
        };
        const r = (0, resolve_js_1.resolveWallboxIntent)({ now: NOW, previous: null, evcc, iobroker: null, admin, override: null, active: true });
        strict_1.default.equal(r.charge_strategy.value, "min_pv");
    });
    (0, node_test_1.it)("admin fills only missing fields", () => {
        const admin = {
            observed_at: ISO,
            charge_strategy: {
                value: "pv",
                status: "valid",
                origin: { source: "admin", owner: "admin_config", change_kind: "configured" },
                observed_at: ISO,
            },
            target_soc_pct: {
                value: 80,
                status: "valid",
                origin: { source: "admin", owner: "admin_config", change_kind: "configured" },
                observed_at: ISO,
            },
            timezone: "Europe/Berlin",
        };
        const r = (0, resolve_js_1.resolveWallboxIntent)({ now: NOW, previous: null, evcc: null, iobroker: null, admin, override: null, active: true });
        strict_1.default.equal(r.charge_strategy.value, "pv");
        strict_1.default.equal(r.target_soc_pct.value, 80);
    });
    (0, node_test_1.it)("manual override scope charge_strategy only", () => {
        const evcc = {
            observed_at: ISO,
            charge_strategy: evccField("pv"),
            target_soc_pct: evccField(90),
            deadline: evccField(null, "missing"),
            status: "ok",
        };
        const iobroker = {
            observed_at: ISO,
            charge_strategy: iobrokerField("immediate"),
            target_soc_pct: null,
            deadline: null,
            manual_override: {
                active: true,
                scope: ["charge_strategy"],
                source: "iobroker",
                owner: "user",
                valid_until: "2026-06-28T00:00:00Z",
            },
            request_id: "r2",
        };
        const r = (0, resolve_js_1.resolveWallboxIntent)({
            now: NOW,
            previous: null,
            evcc,
            iobroker,
            admin: null,
            override: iobroker.manual_override,
            active: true,
        });
        strict_1.default.equal(r.charge_strategy.value, "immediate");
        strict_1.default.equal(r.target_soc_pct.value, 90);
        strict_1.default.equal(r.target_soc_pct.origin.source, "evcc");
    });
    (0, node_test_1.it)("evcc change_kind is unknown not manual_explicit", () => {
        const r = (0, resolve_js_1.resolveWallboxIntent)({
            now: NOW,
            previous: null,
            evcc: evccSnapshot("pv"),
            iobroker: null,
            admin: null,
            override: null,
            active: true,
        });
        strict_1.default.equal(r.charge_strategy.origin.change_kind, "unknown");
    });
    (0, node_test_1.it)("inactive addon -> disabled intent", () => {
        const r = (0, resolve_js_1.resolveWallboxIntent)({
            now: NOW,
            previous: null,
            evcc: evccSnapshot("pv"),
            iobroker: null,
            admin: null,
            override: null,
            active: false,
        });
        strict_1.default.equal(r.intent_state, "disabled");
    });
});
