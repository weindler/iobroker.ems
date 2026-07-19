import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeObjectDump, extractDumpObjects, formatDumpAnalysisMarkdown } from "./analyze_object_dump.js";

describe("analyze_object_dump", () => {
	it("extracts objects from array and map forms without reading values", () => {
		const arr = extractDumpObjects([
			{ _id: "ems.0.global.execution_mode", type: "state", common: { name: "x", type: "string" } },
		]);
		assert.equal(arr.length, 1);
		const map = extractDumpObjects({
			"ems.0.addons.air_conditioning.units.unit_1": {
				type: "channel",
				common: { name: "Unit 1" },
			},
		});
		assert.equal(map.length, 1);
	});

	it("reports object/state counts and gap vs catalog without PII", () => {
		const dump = [
			{ _id: "ems.0.global.execution_mode", type: "state", common: { name: "mode", type: "string" } },
			{ _id: "ems.0.addons.air_conditioning.units", type: "channel", common: { name: "units" } },
			{ _id: "ems.0.addons.air_conditioning.units.unit_1", type: "channel", common: { name: "u1" } },
			{ _id: "ems.0.addons.air_conditioning.units.unit_1.state", type: "state", common: { name: "s", type: "string" } },
			{ _id: "ems.0.addons.air_conditioning.units.unit_2", type: "channel", common: { name: "u2" } },
			{ _id: "ems.0.unknown.family.foo", type: "state", common: { name: "secret", type: "string" } },
		];
		const analysis = analyzeObjectDump(dump);
		assert.equal(analysis.namespace, "ems.0");
		assert.equal(analysis.totalStates, 3);
		assert.ok(analysis.gapVsCatalog !== 0 || analysis.catalogEstimatedStatic > 0);
		const md = formatDumpAnalysisMarkdown(analysis);
		assert.ok(md.includes("Production Gap"));
		assert.ok(!md.includes("secret"));
		assert.ok(analysis.unknownPrefixGroups.some((g) => g.prefix.startsWith("unknown")));
	});
});
