import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDeviceTemplateCatalog } from "./catalog";

describe("device template catalog", () => {
	it("exports only implemented profiles by device class without duplicate ids", () => {
		const catalog = buildDeviceTemplateCatalog();
		const keys = catalog.entries.map((entry) => `${entry.deviceClass}:${entry.templateId}`);
		assert.equal(new Set(keys).size, keys.length);
		assert.ok(catalog.entries.every((entry) => entry.availability === "implemented"));
		assert.ok(catalog.entries.every((entry) => entry.plannerContract === "normalized_contribution_v1"));
		assert.ok(keys.includes("battery:sonnen_em"));
		assert.ok(keys.includes("battery:generic_readonly"));
		assert.ok(keys.includes("climate:samsung_localthings_hass"));
		assert.ok(keys.includes("wallbox:evcc_generic"));
		assert.equal(
			catalog.entries.find((entry) => entry.templateId === "evcc_generic")?.executionAuthority,
			"external",
		);
	});

	it("publishes the target hierarchy device class -> manufacturer -> template", () => {
		const catalog = buildDeviceTemplateCatalog();
		const hierarchicalKeys = catalog.classes.flatMap((deviceClass) =>
			deviceClass.manufacturers.flatMap((manufacturer) =>
				manufacturer.templates.map((template) => `${deviceClass.deviceClass}:${template.templateId}`),
			),
		);
		const flatKeys = catalog.entries.map((entry) => `${entry.deviceClass}:${entry.templateId}`);
		assert.deepEqual([...hierarchicalKeys].sort(), [...flatKeys].sort());
		assert.equal(
			catalog.classes
				.find((deviceClass) => deviceClass.deviceClass === "battery")
				?.manufacturers.find((manufacturer) => manufacturer.manufacturerId === "sonnen")
				?.templates.some((template) => template.templateId === "sonnen_em"),
			true,
		);
		assert.deepEqual(catalog.setupFlow.steps, ["device_class", "manufacturer", "template", "binding"]);
	});

	it("offers an honest generic fallback for every current device class", () => {
		const catalog = buildDeviceTemplateCatalog();
		for (const deviceClass of ["battery", "wallbox", "climate", "immersion_heater"] as const) {
			assert.ok(
				catalog.entries.some(
					(entry) => entry.deviceClass === deviceClass && entry.setup.genericFallback,
				),
				`missing generic fallback for ${deviceClass}`,
			);
		}
		const batteryFallback = catalog.entries.find((entry) => entry.templateId === "generic_readonly");
		assert.equal(batteryFallback?.liveControl, false);
		assert.equal(batteryFallback?.executionAuthority, "read_only");
		assert.equal(batteryFallback?.setup.manualMappingAvailable, true);
	});

	it("does not advertise unimplemented manufacturer templates", () => {
		const catalogJson = JSON.stringify(buildDeviceTemplateCatalog());
		for (const unsupported of ["Victron", "Fronius", "BYD", "Daikin", "Mitsubishi", "KEBA", "openWB"]) {
			assert.equal(catalogJson.includes(unsupported), false);
		}
	});
});
