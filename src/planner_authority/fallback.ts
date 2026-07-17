import type { PlannerPathLayout } from "../planner_paths/paths";
import { writeLegacyPointer } from "./pointer";

export interface LegacyFallbackContext {
	layout: PlannerPathLayout;
	generation: number;
	sessionId: string;
	nowMs: number;
	/** Latch worker authority off until a fresh conscious activation. */
	setLatch: (reason: string) => void;
	/** Drop the active lease and any open publish permit. */
	invalidateLeaseAndPermits: () => void;
	/** Stop routing worker job outcomes into authority publishing. */
	stopWorkerCallback: () => void;
	/** Ask the coordinator to (re)produce the legacy authoritative projection. */
	requestLegacyRun: (reason: string) => void | Promise<void>;
	/** Persist the new public status. */
	writeStatus: () => void | Promise<void>;
}

/**
 * Deterministic legacy fallback. Never throws (best-effort per step) so a single
 * failing step cannot leave the system in an ambiguous authority state.
 */
export async function performLegacyFallback(
	ctx: LegacyFallbackContext,
	reason: string,
): Promise<void> {
	// 1. Latch first so nothing re-activates during the transition.
	try {
		ctx.setLatch(reason);
	} catch {
		// isolated
	}
	// 2. Invalidate lease + permits.
	try {
		ctx.invalidateLeaseAndPermits();
	} catch {
		// isolated
	}
	// 3. Stop the worker publish callback path.
	try {
		ctx.stopWorkerCallback();
	} catch {
		// isolated
	}
	// 4. Point authority back to legacy on disk.
	try {
		await writeLegacyPointer(ctx.layout, {
			generation: ctx.generation,
			sessionId: ctx.sessionId,
			nowMs: ctx.nowMs,
		});
	} catch {
		// isolated — pointer read side defaults to legacy on missing/invalid
	}
	// 5. Request a fresh legacy authoritative run.
	try {
		await ctx.requestLegacyRun(reason);
	} catch {
		// isolated
	}
	// 6. Publish status last.
	try {
		await ctx.writeStatus();
	} catch {
		// isolated
	}
}
