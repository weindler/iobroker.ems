import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateOverrideProposal, sweepExpiredOverrides, resolveActiveOverrideValue } from "./validate";
import type { AiOverrideBounds, AiOverrideProposal } from "./types";

const BASE_BOUNDS: AiOverrideBounds = {
	minValue: 0,
	maxValue: 1,
	maxChangePerStepAbs: 0.2,
	minConfidencePct: 60,
	minSampleCount: 5,
	maxDataAgeDays: 14,
	ttlMs: 60 * 60 * 1000,
};

function proposal(overrides: Partial<AiOverrideProposal> = {}): AiOverrideProposal {
	return {
		parameter: "battery.opportunity_discount_pct",
		originalValue: 0.3,
		proposedValue: 0.4,
		reasoningDe: "Beispiel-Empfehlung.",
		evidence: ["sample_evidence"],
		confidencePct: 80,
		sampleCount: 20,
		dataAgeDays: 2,
		source: "daily_analyst",
		createdAtIso: new Date().toISOString(),
		...overrides,
	};
}

describe("validateOverrideProposal — PFLICHT: Safety-Parameter nie KI-veränderbar", () => {
	it("lehnt SOC-Hard-Minimum ab", () => {
		const r = validateOverrideProposal(
			proposal({ parameter: "battery.soc_hard_min_pct" }),
			BASE_BOUNDS,
			"2026-08-30",
		);
		assert.equal(r.status, "rejected");
		assert.match(r.rejectReasonDe ?? "", /sicherheitsrelevant/);
	});

	it("lehnt Hygiene-Parameter ab", () => {
		const r = validateOverrideProposal(
			proposal({ parameter: "thermal.hygiene_target_temp_c" }),
			BASE_BOUNDS,
			"2026-08-30",
		);
		assert.equal(r.status, "rejected");
	});

	it("lehnt Forced/User-Override/Hard-Off ab", () => {
		for (const p of ["forced.mode", "user_override.active", "external_override.flag", "climate.hard_off_temp_c"]) {
			const r = validateOverrideProposal(proposal({ parameter: p }), BASE_BOUNDS, "2026-08-30");
			assert.equal(r.status, "rejected", p);
		}
	});
});

describe("validateOverrideProposal — Bounds/Evidence/Confidence/Sample/Age", () => {
	it("akzeptiert gültigen Vorschlag innerhalb aller Grenzen", () => {
		const r = validateOverrideProposal(proposal(), BASE_BOUNDS, "2026-08-30");
		assert.equal(r.status, "active");
		assert.equal(r.validatedValue, 0.4);
		assert.equal(r.rejectReasonDe, null);
		assert.ok(Date.parse(r.expiresAtIso) > Date.parse(r.createdAtIso));
	});

	it("lehnt bei fehlender Evidenz ab", () => {
		const r = validateOverrideProposal(proposal({ evidence: [] }), BASE_BOUNDS, "2026-08-30");
		assert.equal(r.status, "rejected");
		assert.match(r.rejectReasonDe ?? "", /Evidenz/);
	});

	it("lehnt bei zu wenig Samples ab", () => {
		const r = validateOverrideProposal(proposal({ sampleCount: 2 }), BASE_BOUNDS, "2026-08-30");
		assert.equal(r.status, "rejected");
		assert.match(r.rejectReasonDe ?? "", /Samples/);
	});

	it("lehnt bei zu niedriger Confidence ab", () => {
		const r = validateOverrideProposal(proposal({ confidencePct: 10 }), BASE_BOUNDS, "2026-08-30");
		assert.equal(r.status, "rejected");
		assert.match(r.rejectReasonDe ?? "", /Confidence/);
	});

	it("lehnt bei zu alten Daten ab", () => {
		const r = validateOverrideProposal(proposal({ dataAgeDays: 30 }), BASE_BOUNDS, "2026-08-30");
		assert.equal(r.status, "rejected");
		assert.match(r.rejectReasonDe ?? "", /alt/);
	});

	it("lehnt bei zu großer Änderung pro Schritt ab", () => {
		const r = validateOverrideProposal(
			proposal({ proposedValue: 0.9, originalValue: 0.3 }),
			BASE_BOUNDS,
			"2026-08-30",
		);
		assert.equal(r.status, "rejected");
		assert.match(r.rejectReasonDe ?? "", /Änderung zu groß/);
	});

	it("klemmt validatedValue auf Wertebereich statt zu erfinden", () => {
		const boundsWide: AiOverrideBounds = { ...BASE_BOUNDS, maxChangePerStepAbs: 5, maxValue: 0.35 };
		const r = validateOverrideProposal(proposal({ proposedValue: 0.5 }), boundsWide, "2026-08-30");
		assert.equal(r.status, "active");
		assert.equal(r.validatedValue, 0.35);
	});
});

describe("TTL / Rollback", () => {
	it("markiert Override nach Ablauf als expired und liefert dann baseConfig (null)", () => {
		const created = new Date("2026-08-30T10:00:00.000Z");
		const bounds: AiOverrideBounds = { ...BASE_BOUNDS, ttlMs: 60_000 };
		const r = validateOverrideProposal(proposal(), bounds, "2026-08-30", created);
		assert.equal(r.status, "active");

		const beforeExpiry = new Date(created.getTime() + 30_000);
		const stillActive = sweepExpiredOverrides([r], beforeExpiry);
		assert.equal(stillActive[0]!.status, "active");
		assert.equal(resolveActiveOverrideValue([r], r.parameter, beforeExpiry), r.validatedValue);

		const afterExpiry = new Date(created.getTime() + 120_000);
		const expired = sweepExpiredOverrides([r], afterExpiry);
		assert.equal(expired[0]!.status, "expired");
		assert.equal(
			resolveActiveOverrideValue([r], r.parameter, afterExpiry),
			null,
			"nach Ablauf muss automatisch baseConfig (kein Override) gelten",
		);
	});

	it("rejected-Override wird niemals als aktiv aufgelöst", () => {
		const r = validateOverrideProposal(
			proposal({ parameter: "battery.soc_hard_min_pct" }),
			BASE_BOUNDS,
			"2026-08-30",
		);
		assert.equal(resolveActiveOverrideValue([r], r.parameter), null);
	});
});
