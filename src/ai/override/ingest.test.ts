import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AiAnalystFinding } from "../daily_analyst/types";
import {
	AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT,
	mergeOpportunityMarginWithOverride,
} from "./allowlist";
import { ingestAnalystFindingsAsOverrides } from "./ingest";
import { readOverrideLedgerStore } from "./persist";
import { sweepExpiredOverrides } from "./validate";

function finding(overrides: Partial<AiAnalystFinding> = {}): AiAnalystFinding {
	return {
		findingType: "grid_balance_too_shy",
		domain: "battery",
		severity: "notice",
		confidencePct: 80,
		evidence: ["SOC 91 %, Preis 39,6 ct, Reserve 3,5 kWh."],
		observedBehaviorDe: "Netzausgleich blieb trotz teurem Preis und hohem SOC zu.",
		suggestedImprovementDe: "Opportunity-Marge leicht senken.",
		affectedParameter: AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT,
		proposedNumericValue: 2,
		expectedDirection: "cost_down",
		uncertaintyDe: "Nur ein Tag.",
		dateKey: "2026-08-30",
		...overrides,
	};
}

describe("mergeOpportunityMarginWithOverride", () => {
	it("ohne Override bleibt die Basis-Marge", () => {
		assert.equal(mergeOpportunityMarginWithOverride(3, null), 3);
	});
	it("aktiver Override ersetzt die Basis", () => {
		assert.equal(mergeOpportunityMarginWithOverride(3, 2), 2);
	});
});

describe("ingestAnalystFindingsAsOverrides", () => {
	it("überspringt Findings ohne numerischen Vorschlag — kein Raten", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ov-"));
		const r = await ingestAnalystFindingsAsOverrides(
			{ getAbsolutePath: () => dir },
			[finding({ proposedNumericValue: null })],
			"2026-08-30",
		);
		assert.equal(r.accepted, 0);
		assert.equal(r.skipped, 1);
	});

	it("lehnt Safety-Parameter ab, auch wenn die KI sie vorschlägt", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ov-"));
		const r = await ingestAnalystFindingsAsOverrides(
			{ getAbsolutePath: () => dir },
			[finding({ affectedParameter: "battery.soc_hard_min_pct", proposedNumericValue: 2 })],
			"2026-08-30",
		);
		assert.equal(r.accepted, 0);
		assert.equal(r.skipped, 1);
	});

	it("akzeptiert Allowlist-Parameter innerhalb der Bounds und schreibt ins Ledger", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ov-"));
		const r = await ingestAnalystFindingsAsOverrides(
			{ getAbsolutePath: () => dir },
			[finding()],
			"2026-08-30",
			new Date("2026-08-31T08:00:00Z"),
		);
		assert.equal(r.accepted, 1);
		assert.equal(r.overrides[0]?.status, "active");
		assert.equal(r.overrides[0]?.validatedValue, 2);
		const store = await readOverrideLedgerStore(dir);
		assert.equal(store.overrides.length, 1);
	});

	it("lehnt Änderung über maxChangePerStep ab", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ov-"));
		const r = await ingestAnalystFindingsAsOverrides(
			{ getAbsolutePath: () => dir },
			[finding({ proposedNumericValue: 9 })],
			"2026-08-30",
		);
		assert.equal(r.rejected, 1);
		assert.equal(r.overrides[0]?.status, "rejected");
	});

	it("TTL: nach Ablauf gilt der Override nicht mehr", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ov-"));
		const created = new Date("2026-08-31T08:00:00Z");
		await ingestAnalystFindingsAsOverrides({ getAbsolutePath: () => dir }, [finding()], "2026-08-30", created);
		const later = new Date(created.getTime() + 25 * 60 * 60 * 1000);
		const store = await readOverrideLedgerStore(dir);
		const swept = sweepExpiredOverrides(store.overrides, later);
		assert.equal(swept[0]?.status, "expired");
	});
});
