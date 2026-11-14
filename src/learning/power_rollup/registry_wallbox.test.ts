import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDensePowerSources } from "./registry";

describe("power rollup registry: wallbox", () => {
	const host = (namespace?: string) => ({
		namespace,
		config: {},
		getStateAsync: async () => null,
	});

	it("registers the EMS wallbox charge power as unidirectional source", async () => {
		const sources = await resolveDensePowerSources(host("ems.0"));
		const wb = sources.find((s) => s.sourceKey === "wallbox.charge_power_w");
		if (!wb) throw new Error("wallbox source missing");
		assert.equal(wb.stateId, "ems.0.addons.wallbox.status.evcc.charge_power_w");
		assert.equal(wb.rollupMode, "unidirectional_avg");
		assert.equal(wb.powerUnit, "W");
	});

	it("skips the wallbox source without namespace", async () => {
		const sources = await resolveDensePowerSources(host(undefined));
		assert.equal(sources.some((s) => s.sourceKey === "wallbox.charge_power_w"), false);
	});
});
