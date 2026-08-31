/**
 * PHASE 6 — Daily-Analyst-Findings in Validator-Vorschläge überführen.
 *
 * Nur wenn Admin `ai_override_enabled` gesetzt ist. Ohne numerischen Vorschlag,
 * ohne Allowlist-Treffer oder bei bereits aktivem Override für denselben Parameter:
 * kein Raten, kein Stacking.
 */

import type { AiAnalystFinding } from "../daily_analyst/types";
import { AI_OVERRIDE_LEDGER_CATEGORY, appendOverrideToLedger, readOverrideLedgerStore } from "./persist";
import { boundsForOverrideParameter, defaultOriginalValueForParameter } from "./allowlist";
import { sweepExpiredOverrides, validateOverrideProposal } from "./validate";
import { AI_VALIDATOR_STATES } from "./ensure_states";
import type { AiOverrideProposal, ValidatedAiOverride } from "./types";

export type OverrideIngestHost = {
	getAbsolutePath: (category?: string) => string;
	setStateAsync?: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
};

export type OverrideIngestResult = {
	considered: number;
	accepted: number;
	rejected: number;
	skipped: number;
	overrides: ValidatedAiOverride[];
};

async function publish(host: OverrideIngestHost, id: string, val: ioBroker.StateValue): Promise<void> {
	if (!host.setStateAsync) return;
	try {
		await host.setStateAsync(id, { val, ack: true });
	} catch {
		/* Transparenz-States sind best-effort */
	}
}

export async function ingestAnalystFindingsAsOverrides(
	host: OverrideIngestHost,
	findings: AiAnalystFinding[],
	dateKey: string,
	now: Date = new Date(),
): Promise<OverrideIngestResult> {
	const result: OverrideIngestResult = {
		considered: 0,
		accepted: 0,
		rejected: 0,
		skipped: 0,
		overrides: [],
	};
	const baseDir = host.getAbsolutePath(AI_OVERRIDE_LEDGER_CATEGORY);
	const store = await readOverrideLedgerStore(baseDir);
	const active = sweepExpiredOverrides(store.overrides, now).filter((o) => o.status === "active");

	for (const f of findings) {
		if (!f.affectedParameter || f.proposedNumericValue === null || !Number.isFinite(f.proposedNumericValue)) {
			result.skipped += 1;
			continue;
		}
		const bounds = boundsForOverrideParameter(f.affectedParameter);
		if (!bounds) {
			result.skipped += 1;
			continue;
		}
		if (active.some((o) => o.parameter === f.affectedParameter)) {
			result.skipped += 1;
			continue;
		}
		const originalValue = defaultOriginalValueForParameter(f.affectedParameter);
		if (originalValue === null) {
			result.skipped += 1;
			continue;
		}
		result.considered += 1;
		const proposal: AiOverrideProposal = {
			parameter: f.affectedParameter,
			originalValue,
			proposedValue: f.proposedNumericValue,
			reasoningDe: f.suggestedImprovementDe,
			evidence: f.evidence,
			confidencePct: f.confidencePct,
			sampleCount: Math.max(1, f.evidence.length),
			dataAgeDays: 1,
			source: "daily_analyst",
			createdAtIso: now.toISOString(),
		};
		const validated = validateOverrideProposal(proposal, bounds, dateKey, now);
		await appendOverrideToLedger(baseDir, validated, now);
		result.overrides.push(validated);
		if (validated.status === "active") {
			result.accepted += 1;
			active.push(validated);
			await publish(host, AI_VALIDATOR_STATES.lastAcceptedParameter, validated.parameter);
		} else {
			result.rejected += 1;
			await publish(host, AI_VALIDATOR_STATES.lastRejectReasonDe, validated.rejectReasonDe ?? "");
		}
	}
	return result;
}
