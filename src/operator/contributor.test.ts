import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	addonContributorRef,
	contributorRefKey,
	parseContributorRef,
	serializeContributorRef,
	systemContributorRef,
} from "./contributor";

describe("operator contributor refs", () => {
	it("addon contributor uses valid addon id", () => {
		const ref = addonContributorRef("pv_forecast");
		assert.equal(ref.type, "addon");
		assert.equal(ref.id, "pv_forecast");
		assert.equal(ref.addonId, "pv_forecast");
	});

	it("system contributor house_load has no addon id", () => {
		const ref = systemContributorRef("house_load");
		assert.equal(ref.type, "system");
		assert.equal(ref.id, "house_load");
		assert.equal(ref.addonId, null);
	});

	it("contributor ref is deterministically serializable", () => {
		const ref = systemContributorRef("grid_supply");
		const raw = serializeContributorRef(ref);
		assert.equal(raw, '{"type":"system","id":"grid_supply","addonId":null}');
		assert.deepEqual(parseContributorRef(raw), ref);
		assert.equal(contributorRefKey(ref), "system:grid_supply");
	});
});
