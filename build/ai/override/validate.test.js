"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const validate_1 = require("./validate");
const BASE_BOUNDS = {
    minValue: 0,
    maxValue: 1,
    maxChangePerStepAbs: 0.2,
    minConfidencePct: 60,
    minSampleCount: 5,
    maxDataAgeDays: 14,
    ttlMs: 60 * 60 * 1000,
};
function proposal(overrides = {}) {
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
(0, node_test_1.describe)("validateOverrideProposal — PFLICHT: Safety-Parameter nie KI-veränderbar", () => {
    (0, node_test_1.it)("lehnt SOC-Hard-Minimum ab", () => {
        const r = (0, validate_1.validateOverrideProposal)(proposal({ parameter: "battery.soc_hard_min_pct" }), BASE_BOUNDS, "2026-08-30");
        strict_1.default.equal(r.status, "rejected");
        strict_1.default.match(r.rejectReasonDe ?? "", /sicherheitsrelevant/);
    });
    (0, node_test_1.it)("lehnt Hygiene-Parameter ab", () => {
        const r = (0, validate_1.validateOverrideProposal)(proposal({ parameter: "thermal.hygiene_target_temp_c" }), BASE_BOUNDS, "2026-08-30");
        strict_1.default.equal(r.status, "rejected");
    });
    (0, node_test_1.it)("lehnt Forced/User-Override/Hard-Off ab", () => {
        for (const p of ["forced.mode", "user_override.active", "external_override.flag", "climate.hard_off_temp_c"]) {
            const r = (0, validate_1.validateOverrideProposal)(proposal({ parameter: p }), BASE_BOUNDS, "2026-08-30");
            strict_1.default.equal(r.status, "rejected", p);
        }
    });
});
(0, node_test_1.describe)("validateOverrideProposal — Bounds/Evidence/Confidence/Sample/Age", () => {
    (0, node_test_1.it)("akzeptiert gültigen Vorschlag innerhalb aller Grenzen", () => {
        const r = (0, validate_1.validateOverrideProposal)(proposal(), BASE_BOUNDS, "2026-08-30");
        strict_1.default.equal(r.status, "active");
        strict_1.default.equal(r.validatedValue, 0.4);
        strict_1.default.equal(r.rejectReasonDe, null);
        strict_1.default.ok(Date.parse(r.expiresAtIso) > Date.parse(r.createdAtIso));
    });
    (0, node_test_1.it)("lehnt bei fehlender Evidenz ab", () => {
        const r = (0, validate_1.validateOverrideProposal)(proposal({ evidence: [] }), BASE_BOUNDS, "2026-08-30");
        strict_1.default.equal(r.status, "rejected");
        strict_1.default.match(r.rejectReasonDe ?? "", /Evidenz/);
    });
    (0, node_test_1.it)("lehnt bei zu wenig Samples ab", () => {
        const r = (0, validate_1.validateOverrideProposal)(proposal({ sampleCount: 2 }), BASE_BOUNDS, "2026-08-30");
        strict_1.default.equal(r.status, "rejected");
        strict_1.default.match(r.rejectReasonDe ?? "", /Samples/);
    });
    (0, node_test_1.it)("lehnt bei zu niedriger Confidence ab", () => {
        const r = (0, validate_1.validateOverrideProposal)(proposal({ confidencePct: 10 }), BASE_BOUNDS, "2026-08-30");
        strict_1.default.equal(r.status, "rejected");
        strict_1.default.match(r.rejectReasonDe ?? "", /Confidence/);
    });
    (0, node_test_1.it)("lehnt bei zu alten Daten ab", () => {
        const r = (0, validate_1.validateOverrideProposal)(proposal({ dataAgeDays: 30 }), BASE_BOUNDS, "2026-08-30");
        strict_1.default.equal(r.status, "rejected");
        strict_1.default.match(r.rejectReasonDe ?? "", /alt/);
    });
    (0, node_test_1.it)("lehnt bei zu großer Änderung pro Schritt ab", () => {
        const r = (0, validate_1.validateOverrideProposal)(proposal({ proposedValue: 0.9, originalValue: 0.3 }), BASE_BOUNDS, "2026-08-30");
        strict_1.default.equal(r.status, "rejected");
        strict_1.default.match(r.rejectReasonDe ?? "", /Änderung zu groß/);
    });
    (0, node_test_1.it)("klemmt validatedValue auf Wertebereich statt zu erfinden", () => {
        const boundsWide = { ...BASE_BOUNDS, maxChangePerStepAbs: 5, maxValue: 0.35 };
        const r = (0, validate_1.validateOverrideProposal)(proposal({ proposedValue: 0.5 }), boundsWide, "2026-08-30");
        strict_1.default.equal(r.status, "active");
        strict_1.default.equal(r.validatedValue, 0.35);
    });
});
(0, node_test_1.describe)("TTL / Rollback", () => {
    (0, node_test_1.it)("markiert Override nach Ablauf als expired und liefert dann baseConfig (null)", () => {
        const created = new Date("2026-08-30T10:00:00.000Z");
        const bounds = { ...BASE_BOUNDS, ttlMs: 60_000 };
        const r = (0, validate_1.validateOverrideProposal)(proposal(), bounds, "2026-08-30", created);
        strict_1.default.equal(r.status, "active");
        const beforeExpiry = new Date(created.getTime() + 30_000);
        const stillActive = (0, validate_1.sweepExpiredOverrides)([r], beforeExpiry);
        strict_1.default.equal(stillActive[0].status, "active");
        strict_1.default.equal((0, validate_1.resolveActiveOverrideValue)([r], r.parameter, beforeExpiry), r.validatedValue);
        const afterExpiry = new Date(created.getTime() + 120_000);
        const expired = (0, validate_1.sweepExpiredOverrides)([r], afterExpiry);
        strict_1.default.equal(expired[0].status, "expired");
        strict_1.default.equal((0, validate_1.resolveActiveOverrideValue)([r], r.parameter, afterExpiry), null, "nach Ablauf muss automatisch baseConfig (kein Override) gelten");
    });
    (0, node_test_1.it)("rejected-Override wird niemals als aktiv aufgelöst", () => {
        const r = (0, validate_1.validateOverrideProposal)(proposal({ parameter: "battery.soc_hard_min_pct" }), BASE_BOUNDS, "2026-08-30");
        strict_1.default.equal((0, validate_1.resolveActiveOverrideValue)([r], r.parameter), null);
    });
});
