/**
 * Worker-dryrun authority lease — branded via WeakSet mint registry.
 * Never JSON-persisted, never written to states, never sent to worker.
 */

import { randomUUID } from "node:crypto";
import { WORKER_DRYRUN_AUTHORITY_LEASE_TTL_MS } from "./constants";
import type { WorkerDryrunAuthorityLease } from "./types";
import {
	isProductiveActivationCapability,
	activationCapabilityExpired,
	type ProductiveTakeoverActivationCapability,
} from "../planner_authorization/activation";

const mintedLeases = new WeakSet<object>();

export interface WorkerDryrunLeaseMintInput {
	capability: ProductiveTakeoverActivationCapability;
	nowMs: number;
	idFactory?: () => string;
	ttlMs?: number;
}

/** Mint a lease from a valid worker-dryrun activation capability. */
export function mintWorkerDryrunAuthorityLease(
	input: WorkerDryrunLeaseMintInput,
): WorkerDryrunAuthorityLease | null {
	const cap = input.capability;
	if (!isProductiveActivationCapability(cap)) return null;
	if (activationCapabilityExpired(cap, input.nowMs)) return null;
	if (cap.scope !== "worker_dryrun" || cap.executionMode !== "dryrun") return null;

	const ttl = Math.max(0, input.ttlMs ?? WORKER_DRYRUN_AUTHORITY_LEASE_TTL_MS);
	const lease = {
		leaseId: (input.idFactory ?? (() => randomUUID()))(),
		adapterInstance: cap.adapterInstance,
		sessionId: cap.sessionId,
		grantId: cap.grantId,
		generation: cap.generation,
		inputRevision: cap.inputRevision,
		candidateRevision: cap.candidateRevision,
		authoritativeRevision: cap.authoritativeRevision,
		evidenceRevision: cap.evidenceRevision,
		issuedAt: new Date(input.nowMs).toISOString(),
		expiresAt: new Date(input.nowMs + ttl).toISOString(),
	};
	mintedLeases.add(lease);
	return lease as WorkerDryrunAuthorityLease;
}

export function isWorkerDryrunAuthorityLease(value: unknown): value is WorkerDryrunAuthorityLease {
	return typeof value === "object" && value !== null && mintedLeases.has(value);
}

export function leaseExpired(lease: WorkerDryrunAuthorityLease, nowMs: number): boolean {
	return Date.parse(lease.expiresAt) <= nowMs;
}
