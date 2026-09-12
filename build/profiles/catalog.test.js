"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const catalog_1 = require("./catalog");
(0, node_test_1.describe)("device template catalog", () => {
    (0, node_test_1.it)("exports only implemented profiles by device class without duplicate ids", () => {
        const catalog = (0, catalog_1.buildDeviceTemplateCatalog)();
        const keys = catalog.entries.map((entry) => `${entry.deviceClass}:${entry.templateId}`);
        strict_1.default.equal(new Set(keys).size, keys.length);
        strict_1.default.ok(catalog.entries.every((entry) => entry.availability === "implemented"));
        strict_1.default.ok(catalog.entries.every((entry) => entry.plannerContract === "normalized_contribution_v1"));
        strict_1.default.ok(keys.includes("battery:sonnen_em"));
        strict_1.default.ok(keys.includes("battery:generic_readonly"));
        strict_1.default.ok(keys.includes("climate:samsung_localthings_hass"));
        strict_1.default.ok(keys.includes("wallbox:evcc_generic"));
        strict_1.default.equal(catalog.entries.find((entry) => entry.templateId === "evcc_generic")?.executionAuthority, "external");
    });
    (0, node_test_1.it)("publishes the target hierarchy device class -> manufacturer -> template", () => {
        const catalog = (0, catalog_1.buildDeviceTemplateCatalog)();
        const hierarchicalKeys = catalog.classes.flatMap((deviceClass) => deviceClass.manufacturers.flatMap((manufacturer) => manufacturer.templates.map((template) => `${deviceClass.deviceClass}:${template.templateId}`)));
        const flatKeys = catalog.entries.map((entry) => `${entry.deviceClass}:${entry.templateId}`);
        strict_1.default.deepEqual([...hierarchicalKeys].sort(), [...flatKeys].sort());
        strict_1.default.equal(catalog.classes
            .find((deviceClass) => deviceClass.deviceClass === "battery")
            ?.manufacturers.find((manufacturer) => manufacturer.manufacturerId === "sonnen")
            ?.templates.some((template) => template.templateId === "sonnen_em"), true);
        strict_1.default.deepEqual(catalog.setupFlow.steps, ["device_class", "manufacturer", "template", "binding"]);
    });
    (0, node_test_1.it)("offers an honest generic fallback for every current device class", () => {
        const catalog = (0, catalog_1.buildDeviceTemplateCatalog)();
        for (const deviceClass of ["battery", "wallbox", "climate", "immersion_heater"]) {
            strict_1.default.ok(catalog.entries.some((entry) => entry.deviceClass === deviceClass && entry.setup.genericFallback), `missing generic fallback for ${deviceClass}`);
        }
        const batteryFallback = catalog.entries.find((entry) => entry.templateId === "generic_readonly");
        strict_1.default.equal(batteryFallback?.liveControl, false);
        strict_1.default.equal(batteryFallback?.executionAuthority, "read_only");
        strict_1.default.equal(batteryFallback?.setup.manualMappingAvailable, true);
    });
    (0, node_test_1.it)("does not advertise unimplemented manufacturer templates", () => {
        const catalogJson = JSON.stringify((0, catalog_1.buildDeviceTemplateCatalog)());
        for (const unsupported of ["Victron", "Fronius", "BYD", "Daikin", "Mitsubishi", "KEBA", "openWB"]) {
            strict_1.default.equal(catalogJson.includes(unsupported), false);
        }
    });
});
