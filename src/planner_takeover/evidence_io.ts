import * as fs from "node:fs/promises";
import * as path from "node:path";
import { sha256Hex } from "../planner_repository/hash";
import { TAKEOVER_EVIDENCE_BUDGET_BYTES, TAKEOVER_EVIDENCE_FILE } from "./constants";
import { reconcileLoadedEvidence, sealEvidence, emptyTakeoverEvidence } from "./evidence";
import type { PlannerTakeoverEvidence } from "./types";
import type { TakeoverReadinessPolicy } from "./constants";
import { DEFAULT_TAKEOVER_READINESS_POLICY } from "./constants";

export async function writeTakeoverEvidenceAtomic(
	dir: string,
	evidence: PlannerTakeoverEvidence,
): Promise<{ path: string; byteSize: number; sha256: string }> {
	await fs.mkdir(dir, { recursive: true, mode: 0o700 });
	const target = path.join(dir, TAKEOVER_EVIDENCE_FILE);
	const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
	const sealed = evidence.evidenceRevision
		? evidence
		: sealEvidence(evidence);
	const json = `${JSON.stringify(sealed, null, 2)}\n`;
	const byteSize = Buffer.byteLength(json, "utf8");
	if (byteSize > TAKEOVER_EVIDENCE_BUDGET_BYTES) {
		throw new Error(`evidence_budget_exceeded:${byteSize}`);
	}
	await fs.writeFile(tmp, json, { mode: 0o600 });
	await fs.rename(tmp, target);
	return { path: target, byteSize, sha256: sha256Hex(json) };
}

export async function readTakeoverEvidenceFile(
	dir: string,
	policy: TakeoverReadinessPolicy = DEFAULT_TAKEOVER_READINESS_POLICY,
): Promise<{ evidence: PlannerTakeoverEvidence; resetReason: string | null }> {
	const target = path.join(dir, TAKEOVER_EVIDENCE_FILE);
	try {
		const raw = await fs.readFile(target, "utf8");
		const byteSize = Buffer.byteLength(raw, "utf8");
		if (byteSize > TAKEOVER_EVIDENCE_BUDGET_BYTES) {
			return {
				evidence: sealEvidence({
					...emptyTakeoverEvidence(policy),
					state: "collecting",
					lastBlockReason: "policy_reset",
				}),
				resetReason: "budget_exceeded",
			};
		}
		const parsed = JSON.parse(raw) as unknown;
		return reconcileLoadedEvidence(parsed, policy);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes("ENOENT")) {
			return {
				evidence: sealEvidence({ ...emptyTakeoverEvidence(policy), state: "not_evaluated" }),
				resetReason: "missing",
			};
		}
		return {
			evidence: sealEvidence({
				...emptyTakeoverEvidence(policy),
				state: "collecting",
				lastBlockReason: "policy_reset",
			}),
			resetReason: "corrupt",
		};
	}
}
