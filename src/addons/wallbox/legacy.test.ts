import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addonHasCapability, isReadOnlyAddon } from "../registry";
import { legacyWallboxMappingFromConfig } from "../../mapping_config";

describe("wallbox legacy abgrenzung", () => {
	it("wallbox addon is read-only in registry", () => {
		assert.equal(isReadOnlyAddon("wallbox"), true);
		assert.equal(addonHasCapability("wallbox", "supports_enable_disable"), false);
	});

	it("legacy mapping parser still loads old config keys", () => {
		const m = legacyWallboxMappingFromConfig({
			wb_set_enabled_target: "go-e.0.allow_charging",
			wb_set_current_a_target: "go-e.0.amperePV",
		});
		assert.equal(m.set_enabled?.target_state, "go-e.0.allow_charging");
		assert.equal(m.set_current_a?.target_state, "go-e.0.amperePV");
	});
});
