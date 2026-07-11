import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EMS_ADDON_IDS } from "../addons/registry";
import {
	OPERATOR_ADDON_REGISTRY,
	operatorAddonRegistration,
	operatorRegistryCoversAllCatalogAddons,
	operatorRegistryAddonIds,
} from "./registry";

describe("operator addon registry", () => {
	it("covers all catalog addon IDs", () => {
		assert.equal(operatorRegistryCoversAllCatalogAddons(), true);
		assert.equal(OPERATOR_ADDON_REGISTRY.length, EMS_ADDON_IDS.length);
		for (const id of EMS_ADDON_IDS) {
			assert.doesNotThrow(() => operatorAddonRegistration(id));
		}
	});

	it("has no unknown registry IDs", () => {
		const catalog = new Set<string>(EMS_ADDON_IDS);
		for (const entry of OPERATOR_ADDON_REGISTRY) {
			assert.ok(catalog.has(entry.addonId), `unknown registry addon ${entry.addonId}`);
		}
	});

	it("battery has storage and dispatch roles", () => {
		const battery = operatorAddonRegistration("battery");
		assert.ok(battery.roles.includes("storage"));
		assert.ok(battery.roles.includes("dispatch"));
		assert.ok(battery.roles.includes("demand_flex"));
		assert.equal(battery.canDispatch, true);
		assert.equal(battery.requiresGovernance, true);
	});

	it("wallbox and immersion_heater are flexible demand/dispatch", () => {
		for (const id of ["wallbox", "immersion_heater"] as const) {
			const entry = operatorAddonRegistration(id);
			assert.ok(entry.roles.includes("demand_flex"));
			assert.ok(entry.roles.includes("dispatch"));
			assert.equal(entry.canContributeToPlan, true);
		}
	});

	it("infrastructure addons are not dispatch", () => {
		for (const id of ["sensorics", "series_storage"] as const) {
			const entry = operatorAddonRegistration(id);
			assert.ok(entry.roles.includes("infrastructure"));
			assert.equal(entry.canDispatch, false);
		}
	});

	it("registry IDs match catalog order coverage", () => {
		const regIds = new Set(operatorRegistryAddonIds());
		assert.equal(regIds.size, EMS_ADDON_IDS.length);
	});
});
