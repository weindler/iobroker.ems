import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	DOMAIN_QUALITY,
	TELEMETRY_DOMAIN,
	decodeDomainQuality,
	encodeDomainQuality,
	encodeQualityMask,
	worstDomainQuality,
} from "./quality_mask.js";

describe("day_telemetry quality mask", () => {
	it("17) Encode/Decode Roundtrip", () => {
		let mask = 0;
		mask = encodeDomainQuality(mask, TELEMETRY_DOMAIN.PV, DOMAIN_QUALITY.ok);
		mask = encodeDomainQuality(mask, TELEMETRY_DOMAIN.HOUSE, DOMAIN_QUALITY.partial);
		mask = encodeDomainQuality(mask, TELEMETRY_DOMAIN.GRID, DOMAIN_QUALITY.missing);
		mask = encodeDomainQuality(mask, TELEMETRY_DOMAIN.PLANNER, DOMAIN_QUALITY.na);
		assert.equal(decodeDomainQuality(mask, TELEMETRY_DOMAIN.PV), DOMAIN_QUALITY.ok);
		assert.equal(decodeDomainQuality(mask, TELEMETRY_DOMAIN.HOUSE), DOMAIN_QUALITY.partial);
		assert.equal(decodeDomainQuality(mask, TELEMETRY_DOMAIN.GRID), DOMAIN_QUALITY.missing);
		assert.equal(decodeDomainQuality(mask, TELEMETRY_DOMAIN.PLANNER), DOMAIN_QUALITY.na);
		assert.equal(worstDomainQuality(mask), DOMAIN_QUALITY.missing);
	});

	it("encodeQualityMask helper", () => {
		const m = encodeQualityMask({ PV: DOMAIN_QUALITY.ok, EV: DOMAIN_QUALITY.missing });
		assert.equal(decodeDomainQuality(m, TELEMETRY_DOMAIN.PV), DOMAIN_QUALITY.ok);
		assert.equal(decodeDomainQuality(m, TELEMETRY_DOMAIN.EV), DOMAIN_QUALITY.missing);
	});
});
