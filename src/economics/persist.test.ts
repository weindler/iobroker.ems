import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pruneEconomicsPersist } from "./persist";
import { emptyEconomicsPersist, type EconomicsDayRecord } from "./types";

function record(dateKey: string): EconomicsDayRecord {
	return {
		dateKey,
		generatedAtIso: `${dateKey}T23:59:00.000Z`,
		final: true,
		tarifvorteilEur: null,
		emsVorteilEur: null,
		kiMehrwertEur: null,
		gridRewardsCreditEur: null,
		gridRewardsSource: null,
		realNetCostEur: null,
		referenceNoEmsNetCostEur: null,
		emsWithoutAiNetCostEur: null,
		shadowModelVersion: null,
		emsVorteilEvaluable: false,
		kiMehrwertEvaluable: false,
		notesDe: [],
	};
}

describe("economics persist retention", () => {
	it("keeps the configured rolling accounting window", () => {
		const persist = emptyEconomicsPersist();
		persist.days = {
			"2026-09-09": record("2026-09-09"),
			"2026-09-10": record("2026-09-10"),
			"2026-09-12": record("2026-09-12"),
		};
		const pruned = pruneEconomicsPersist(persist, "2026-09-12", 3);
		assert.deepEqual(Object.keys(pruned.days).sort(), ["2026-09-10", "2026-09-12"]);
	});
});
