"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const quality_1 = require("../quality");
const constraints_1 = require("./constraints");
(0, node_test_1.describe)("constraint contributions", () => {
    const now = new Date("2026-07-11T10:00:00.000Z");
    const base = {
        now,
        globalMode: "balanced",
        configuredHouseFuseLimitW: 13800,
        configuredMaxGridImportW: 11000,
        effectiveMaxGridImportW: 9000,
        gridImportAllowed: true,
        gridSupplyQuality: (0, quality_1.operatorQuality)("valid", "OK"),
    };
    (0, node_test_1.it)("exposes configured fuse and import limits", () => {
        const fuse = (0, constraints_1.buildHouseMainFuseConstraintContribution)(base);
        strict_1.default.equal(fuse.contributor.id, "house_main_fuse");
        strict_1.default.equal(fuse.details.configuredHouseFuseLimitW, 13800);
        strict_1.default.equal(fuse.details.configuredMaxGridImportW, 11000);
    });
    (0, node_test_1.it)("uses smaller effective import limit from global constraints", () => {
        const global = (0, constraints_1.buildGlobalConstraintsContribution)({
            ...base,
            effectiveMaxGridImportW: 9000,
            configuredMaxGridImportW: 11000,
        });
        strict_1.default.equal(global.details.effectiveMaxGridImportW, 9000);
    });
    (0, node_test_1.it)("reflects policy blocking import", () => {
        const global = (0, constraints_1.buildGlobalConstraintsContribution)({
            ...base,
            gridImportAllowed: false,
        });
        strict_1.default.equal(global.details.gridImportAllowed, false);
    });
    (0, node_test_1.it)("keeps missing limits null", () => {
        const fuse = (0, constraints_1.buildHouseMainFuseConstraintContribution)({
            ...base,
            configuredHouseFuseLimitW: null,
            configuredMaxGridImportW: null,
        });
        strict_1.default.equal(fuse.enabled, false);
        strict_1.default.equal(fuse.quality.status, "missing");
    });
});
