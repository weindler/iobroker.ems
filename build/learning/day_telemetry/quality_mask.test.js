"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const quality_mask_js_1 = require("./quality_mask.js");
(0, node_test_1.describe)("day_telemetry quality mask", () => {
    (0, node_test_1.it)("17) Encode/Decode Roundtrip", () => {
        let mask = 0;
        mask = (0, quality_mask_js_1.encodeDomainQuality)(mask, quality_mask_js_1.TELEMETRY_DOMAIN.PV, quality_mask_js_1.DOMAIN_QUALITY.ok);
        mask = (0, quality_mask_js_1.encodeDomainQuality)(mask, quality_mask_js_1.TELEMETRY_DOMAIN.HOUSE, quality_mask_js_1.DOMAIN_QUALITY.partial);
        mask = (0, quality_mask_js_1.encodeDomainQuality)(mask, quality_mask_js_1.TELEMETRY_DOMAIN.GRID, quality_mask_js_1.DOMAIN_QUALITY.missing);
        mask = (0, quality_mask_js_1.encodeDomainQuality)(mask, quality_mask_js_1.TELEMETRY_DOMAIN.PLANNER, quality_mask_js_1.DOMAIN_QUALITY.na);
        strict_1.default.equal((0, quality_mask_js_1.decodeDomainQuality)(mask, quality_mask_js_1.TELEMETRY_DOMAIN.PV), quality_mask_js_1.DOMAIN_QUALITY.ok);
        strict_1.default.equal((0, quality_mask_js_1.decodeDomainQuality)(mask, quality_mask_js_1.TELEMETRY_DOMAIN.HOUSE), quality_mask_js_1.DOMAIN_QUALITY.partial);
        strict_1.default.equal((0, quality_mask_js_1.decodeDomainQuality)(mask, quality_mask_js_1.TELEMETRY_DOMAIN.GRID), quality_mask_js_1.DOMAIN_QUALITY.missing);
        strict_1.default.equal((0, quality_mask_js_1.decodeDomainQuality)(mask, quality_mask_js_1.TELEMETRY_DOMAIN.PLANNER), quality_mask_js_1.DOMAIN_QUALITY.na);
        strict_1.default.equal((0, quality_mask_js_1.worstDomainQuality)(mask), quality_mask_js_1.DOMAIN_QUALITY.missing);
    });
    (0, node_test_1.it)("encodeQualityMask helper", () => {
        const m = (0, quality_mask_js_1.encodeQualityMask)({ PV: quality_mask_js_1.DOMAIN_QUALITY.ok, EV: quality_mask_js_1.DOMAIN_QUALITY.missing });
        strict_1.default.equal((0, quality_mask_js_1.decodeDomainQuality)(m, quality_mask_js_1.TELEMETRY_DOMAIN.PV), quality_mask_js_1.DOMAIN_QUALITY.ok);
        strict_1.default.equal((0, quality_mask_js_1.decodeDomainQuality)(m, quality_mask_js_1.TELEMETRY_DOMAIN.EV), quality_mask_js_1.DOMAIN_QUALITY.missing);
    });
});
