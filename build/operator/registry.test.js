"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const registry_1 = require("../addons/registry");
const registry_2 = require("./registry");
(0, node_test_1.describe)("operator addon registry", () => {
    (0, node_test_1.it)("covers all catalog addon IDs", () => {
        strict_1.default.equal((0, registry_2.operatorRegistryCoversAllCatalogAddons)(), true);
        strict_1.default.equal(registry_2.OPERATOR_ADDON_REGISTRY.length, registry_1.EMS_ADDON_IDS.length);
        for (const id of registry_1.EMS_ADDON_IDS) {
            strict_1.default.doesNotThrow(() => (0, registry_2.operatorAddonRegistration)(id));
        }
    });
    (0, node_test_1.it)("has no unknown registry IDs", () => {
        const catalog = new Set(registry_1.EMS_ADDON_IDS);
        for (const entry of registry_2.OPERATOR_ADDON_REGISTRY) {
            strict_1.default.ok(catalog.has(entry.addonId), `unknown registry addon ${entry.addonId}`);
        }
    });
    (0, node_test_1.it)("battery has storage and dispatch roles", () => {
        const battery = (0, registry_2.operatorAddonRegistration)("battery");
        strict_1.default.ok(battery.roles.includes("storage"));
        strict_1.default.ok(battery.roles.includes("dispatch"));
        strict_1.default.ok(battery.roles.includes("demand_flex"));
        strict_1.default.equal(battery.canDispatch, true);
        strict_1.default.equal(battery.requiresGovernance, true);
    });
    (0, node_test_1.it)("wallbox and immersion_heater are flexible demand/dispatch", () => {
        for (const id of ["wallbox", "immersion_heater"]) {
            const entry = (0, registry_2.operatorAddonRegistration)(id);
            strict_1.default.ok(entry.roles.includes("demand_flex"));
            strict_1.default.ok(entry.roles.includes("dispatch"));
            strict_1.default.equal(entry.canContributeToPlan, true);
        }
    });
    (0, node_test_1.it)("infrastructure addons are not dispatch", () => {
        for (const id of ["sensorics", "series_storage"]) {
            const entry = (0, registry_2.operatorAddonRegistration)(id);
            strict_1.default.ok(entry.roles.includes("infrastructure"));
            strict_1.default.equal(entry.canDispatch, false);
        }
    });
    (0, node_test_1.it)("registry IDs match catalog order coverage", () => {
        const regIds = new Set((0, registry_2.operatorRegistryAddonIds)());
        strict_1.default.equal(regIds.size, registry_1.EMS_ADDON_IDS.length);
    });
});
