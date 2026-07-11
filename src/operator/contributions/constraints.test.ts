import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { operatorQuality } from "../quality";
import {
	buildGlobalConstraintsContribution,
	buildHouseMainFuseConstraintContribution,
} from "./constraints";

describe("constraint contributions", () => {
	const now = new Date("2026-07-11T10:00:00.000Z");
	const base = {
		now,
		globalMode: "balanced",
		configuredHouseFuseLimitW: 13800,
		configuredMaxGridImportW: 11000,
		effectiveMaxGridImportW: 9000,
		gridImportAllowed: true,
		gridSupplyQuality: operatorQuality("valid", "OK"),
	};

	it("exposes configured fuse and import limits", () => {
		const fuse = buildHouseMainFuseConstraintContribution(base);
		assert.equal(fuse.contributor.id, "house_main_fuse");
		assert.equal(fuse.details.configuredHouseFuseLimitW, 13800);
		assert.equal(fuse.details.configuredMaxGridImportW, 11000);
	});

	it("uses smaller effective import limit from global constraints", () => {
		const global = buildGlobalConstraintsContribution({
			...base,
			effectiveMaxGridImportW: 9000,
			configuredMaxGridImportW: 11000,
		});
		assert.equal(global.details.effectiveMaxGridImportW, 9000);
	});

	it("reflects policy blocking import", () => {
		const global = buildGlobalConstraintsContribution({
			...base,
			gridImportAllowed: false,
		});
		assert.equal(global.details.gridImportAllowed, false);
	});

	it("keeps missing limits null", () => {
		const fuse = buildHouseMainFuseConstraintContribution({
			...base,
			configuredHouseFuseLimitW: null,
			configuredMaxGridImportW: null,
		});
		assert.equal(fuse.enabled, false);
		assert.equal(fuse.quality.status, "missing");
	});
});
