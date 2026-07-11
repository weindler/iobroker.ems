"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const control_object_meta_js_1 = require("./control_object_meta.js");
(0, node_test_1.describe)("wallbox control object meta", () => {
    (0, node_test_1.it)("rejects missing object", () => {
        const r = (0, control_object_meta_js_1.validateControlObjectMeta)(undefined, "boolean");
        strict_1.default.equal(r.valid, false);
        strict_1.default.equal(r.reason, "target_object_missing");
    });
    (0, node_test_1.it)("rejects non-writable target", () => {
        const r = (0, control_object_meta_js_1.validateControlObjectMeta)((0, control_object_meta_js_1.metaFromObject)("evcc.0.loadpoint.1.enabled", {
            _type: "state",
            common: { type: "boolean", read: true, write: false },
        }), "boolean");
        strict_1.default.equal(r.valid, false);
        strict_1.default.equal(r.reason, "target_not_writable");
    });
    (0, node_test_1.it)("rejects wrong type", () => {
        const r = (0, control_object_meta_js_1.validateControlObjectMeta)((0, control_object_meta_js_1.metaFromObject)("evcc.0.loadpoint.1.minCurrent", {
            _type: "state",
            common: { type: "string", read: true, write: true },
        }), "number");
        strict_1.default.equal(r.valid, false);
        strict_1.default.equal(r.reason, "target_type_mismatch");
    });
    (0, node_test_1.it)("rejects go-e target for evcc path", () => {
        const meta = (0, control_object_meta_js_1.metaFromObject)("go-e.0.allow_charging", {
            _type: "state",
            common: { type: "boolean", read: true, write: true },
        });
        const r = (0, control_object_meta_js_1.validateEvccControlTargetMeta)("go-e.0.allow_charging", "boolean", meta, "set_mode");
        strict_1.default.equal(r.valid, false);
        strict_1.default.equal(r.reason, "goe_target_not_evcc_compatible");
    });
    (0, node_test_1.it)("rejects enabled state as set_mode target", () => {
        const meta = (0, control_object_meta_js_1.metaFromObject)("evcc.0.loadpoint.1.enabled", {
            _type: "state",
            common: { type: "boolean", read: true, write: true },
        });
        const r = (0, control_object_meta_js_1.validateEvccControlTargetMeta)("evcc.0.loadpoint.1.enabled", "string", meta, "set_mode");
        strict_1.default.equal(r.valid, false);
        strict_1.default.equal(r.reason, "enabled_not_evcc_mode");
    });
    (0, node_test_1.it)("rejects minCurrent as set_max_current_a target", () => {
        const meta = (0, control_object_meta_js_1.metaFromObject)("evcc.0.loadpoint.1.minCurrent", {
            _type: "state",
            common: { type: "number", read: true, write: true },
        });
        const r = (0, control_object_meta_js_1.validateEvccControlTargetMeta)("evcc.0.loadpoint.1.minCurrent", "number", meta, "set_max_current_a");
        strict_1.default.equal(r.valid, false);
        strict_1.default.equal(r.reason, "min_current_not_max_current");
    });
    (0, node_test_1.it)("unknown enum value is rejected when states defined", () => {
        const meta = (0, control_object_meta_js_1.metaFromObject)("evcc.0.loadpoint.1.mode", {
            _type: "state",
            common: {
                type: "string",
                read: true,
                write: true,
                states: { pv: "PV", off: "Aus" },
            },
        });
        const ok = (0, control_object_meta_js_1.validateEnumValueAgainstMeta)("now", meta);
        strict_1.default.equal(ok.valid, false);
        strict_1.default.equal(ok.reason, "enum_value_not_allowed");
    });
    (0, node_test_1.it)("enum unconfirmed when common.states missing", () => {
        const meta = (0, control_object_meta_js_1.metaFromObject)("evcc.0.loadpoint.1.mode", {
            _type: "state",
            common: { type: "string", read: true, write: true },
        });
        const r = (0, control_object_meta_js_1.validateEnumValueAgainstMeta)("pv", meta);
        strict_1.default.equal(r.valid, false);
        strict_1.default.equal(r.reason, "enum_values_unconfirmed");
    });
});
