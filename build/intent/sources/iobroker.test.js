"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const iobroker_js_1 = require("./iobroker.js");
const ADMIN = { defaultChargeStrategy: null, defaultTargetSocPct: null, timezone: "Europe/Berlin", manualOverrideMaxMinutes: 60 };
const NOW = new Date("2026-06-27T12:00:00Z");
function validRequest(overrides = {}) {
    return {
        schema_version: 1,
        request_id: "req-1",
        issued_at: "2026-06-27T12:00:00Z",
        owner: { type: "user", id: "local_user" },
        values: { charge_strategy: "immediate", target_soc_pct: 80 },
        ...overrides,
    };
}
(0, node_test_1.describe)("iobroker intent request", () => {
    (0, node_test_1.it)("accepts valid request", () => {
        const out = (0, iobroker_js_1.processIobrokerWallboxRequest)({
            raw: JSON.stringify(validRequest()),
            ack: false,
            now: NOW,
            admin: ADMIN,
            lastRequestId: null,
            currentRevision: 0,
            existingSnapshot: null,
        });
        strict_1.default.equal(out.result.status, "accepted");
        strict_1.default.equal(out.accepted, true);
    });
    (0, node_test_1.it)("rejects invalid json", () => {
        const out = (0, iobroker_js_1.processIobrokerWallboxRequest)({
            raw: "{bad",
            ack: false,
            now: NOW,
            admin: ADMIN,
            lastRequestId: null,
            currentRevision: 0,
            existingSnapshot: null,
        });
        strict_1.default.equal(out.result.status, "rejected_invalid");
    });
    (0, node_test_1.it)("rejects missing request_id", () => {
        const p = (0, iobroker_js_1.parseIobrokerRequest)({ schema_version: 1, issued_at: "x", owner: { type: "user" } });
        strict_1.default.equal(p.ok, false);
    });
    (0, node_test_1.it)("duplicate request_id", () => {
        const out = (0, iobroker_js_1.processIobrokerWallboxRequest)({
            raw: JSON.stringify(validRequest()),
            ack: false,
            now: NOW,
            admin: ADMIN,
            lastRequestId: "req-1",
            currentRevision: 1,
            existingSnapshot: null,
        });
        strict_1.default.equal(out.result.status, "duplicate");
    });
    (0, node_test_1.it)("ignores ack=true", () => {
        const out = (0, iobroker_js_1.processIobrokerWallboxRequest)({
            raw: JSON.stringify(validRequest()),
            ack: true,
            now: NOW,
            admin: ADMIN,
            lastRequestId: null,
            currentRevision: 0,
            existingSnapshot: null,
        });
        strict_1.default.equal(out.accepted, false);
        strict_1.default.ok(out.result.errors.includes("ack_true_ignored"));
    });
    (0, node_test_1.it)("clear_fields removes field", () => {
        const existing = {
            observed_at: NOW.toISOString(),
            charge_strategy: {
                value: "pv",
                status: "valid",
                origin: { source: "iobroker", owner: "user", change_kind: "manual_explicit" },
                observed_at: NOW.toISOString(),
            },
            target_soc_pct: null,
            deadline: null,
            manual_override: null,
            request_id: "old",
        };
        const out = (0, iobroker_js_1.processIobrokerWallboxRequest)({
            raw: JSON.stringify(validRequest({ request_id: "req-2", values: {}, clear_fields: ["charge_strategy"] })),
            ack: false,
            now: NOW,
            admin: ADMIN,
            lastRequestId: null,
            currentRevision: 1,
            existingSnapshot: existing,
        });
        strict_1.default.equal(out.accepted, true);
        strict_1.default.equal(out.snapshot?.charge_strategy, null);
    });
});
