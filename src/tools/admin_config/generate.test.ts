import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildClimateUnitItems, buildClimateTabItems } from "./generate";
import { CLIMATE_UNIT_SHAPE } from "./climate_unit_shape";
import { CLIMATE_UNIT_DEFAULTS } from "./climate_unit_defaults";

describe("admin_config climate generator", () => {
	it("builds all shape keys for every unit, with {N} fully substituted", () => {
		for (let unit = 1; unit <= 5; unit++) {
			const items = buildClimateUnitItems(unit);
			assert.equal(items.length, CLIMATE_UNIT_SHAPE.length);
			for (const [key, value] of items) {
				assert.ok(!key.includes("{N}"), `key ${key} still has placeholder`);
				assert.ok(!JSON.stringify(value).includes("{N}"), `value for ${key} still has placeholder`);
				assert.ok(!JSON.stringify(value).includes("__override__"), `value for ${key} still has unresolved override marker`);
			}
		}
	});

	it("applies the per-unit override value for a personalized field", () => {
		const unit2 = buildClimateUnitItems(2);
		const entry = unit2.find(([key]) => key === "ac_u2_name");
		assert.ok(entry);
		const [, value] = entry as [string, Record<string, unknown>];
		assert.equal(value.default, CLIMATE_UNIT_DEFAULTS["2"].name);
	});

	it("omits the default key when the unit has no override value configured (e.g. unused slot)", () => {
		const unit3 = buildClimateUnitItems(3);
		const entry = unit3.find(([key]) => key === "ac_u3_room_temp_target");
		assert.ok(entry);
		const [, value] = entry as [string, Record<string, unknown>];
		assert.ok(!("default" in value), "unconfigured unit 3 room_temp_target should not carry a default key");
	});

	it("throws for an unknown unit number (no defaults registered)", () => {
		assert.throws(() => buildClimateUnitItems(6));
	});

	it("buildClimateTabItems keeps the 6 global climate keys plus 5x70 unit keys, rejects a missing global key", () => {
		const existing: Record<string, unknown> = {
			introAc: { type: "staticText" },
			climateGovernanceHint: { type: "staticText" },
			ac_addon_mode: { type: "select" },
			ac_outdoor_max_power_w: { type: "number" },
			ac_planner_outdoor_likely_temp_c: { type: "number" },
			ac_default_profile: { type: "select" },
		};
		const full = buildClimateTabItems(existing);
		assert.equal(Object.keys(full).length, 6 + 5 * CLIMATE_UNIT_SHAPE.length);

		const { ac_addon_mode: _drop, ...incomplete } = existing;
		assert.throws(() => buildClimateTabItems(incomplete));
	});
});
