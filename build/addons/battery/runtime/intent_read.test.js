"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const types_1 = require("../../../intent/battery/types");
const intent_read_1 = require("./intent_read");
function holdFrom(source, owner) {
    const intent = (0, types_1.emptyResolvedBatteryIntent)(new Date("2026-09-19T12:00:00.000Z"), "main");
    intent.intent_state = "available";
    intent.operating_request = {
        value: "hold",
        status: "valid",
        origin: { source, owner, change_kind: source === "evcc" ? "unknown" : "manual_explicit" },
        observed_at: "2026-09-19T12:00:00.000Z",
    };
    return intent;
}
(0, node_test_1.describe)("resolved battery operating request provenance", () => {
    (0, node_test_1.it)("does not treat EVCC hold telemetry as a persistent user hold", () => {
        strict_1.default.equal((0, intent_read_1.resolvedIntentHasExplicitOperatingRequest)(holdFrom("evcc", "evcc"), "hold"), false);
    });
    (0, node_test_1.it)("preserves an explicit ioBroker user hold", () => {
        strict_1.default.equal((0, intent_read_1.resolvedIntentHasExplicitOperatingRequest)(holdFrom("iobroker", "user"), "hold"), true);
    });
});
