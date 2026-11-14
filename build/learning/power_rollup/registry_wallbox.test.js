"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const registry_1 = require("./registry");
(0, node_test_1.describe)("power rollup registry: wallbox", () => {
    const host = (namespace) => ({
        namespace,
        config: {},
        getStateAsync: async () => null,
    });
    (0, node_test_1.it)("registers the EMS wallbox charge power as unidirectional source", async () => {
        const sources = await (0, registry_1.resolveDensePowerSources)(host("ems.0"));
        const wb = sources.find((s) => s.sourceKey === "wallbox.charge_power_w");
        if (!wb)
            throw new Error("wallbox source missing");
        strict_1.default.equal(wb.stateId, "ems.0.addons.wallbox.status.evcc.charge_power_w");
        strict_1.default.equal(wb.rollupMode, "unidirectional_avg");
        strict_1.default.equal(wb.powerUnit, "W");
    });
    (0, node_test_1.it)("skips the wallbox source without namespace", async () => {
        const sources = await (0, registry_1.resolveDensePowerSources)(host(undefined));
        strict_1.default.equal(sources.some((s) => s.sourceKey === "wallbox.charge_power_w"), false);
    });
});
