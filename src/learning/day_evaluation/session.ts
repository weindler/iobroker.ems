/**
 * In-Tick Day-Session für Replan-Historie + Tagesabschluss.
 * Persistenz der Evaluation ist restart-sicher; Session-Metadaten sind best-effort.
 */

import type { UnifiedDayPlan } from "../../operator/daily_plan/unified/types";
import { snapshotFromUnifiedSession, type DayEvalActuals, type DayEvalSessionSnapshot } from "./build";
import { closeDayEvaluationOnce } from "./close";

export type DayPlanSession = {
	date: string;
	timezone: string;
	initialPlanId: string | null;
	initialGeneration: number | null;
	initialExpectedPvKwh: number | null;
	batteryStartSocPct: number | null;
	plannedImmersionTargetTempC: number | null;
	replanReasons: string[];
	/** Anzahl Unified-Publishes am Tag (1 = initial). */
	publishCount: number;
	lastPlan: UnifiedDayPlan | null;
};

let session: DayPlanSession | null = null;

export function resetDayPlanSessionForTest(): void {
	session = null;
}

export function getDayPlanSession(): DayPlanSession | null {
	return session ? { ...session, replanReasons: [...session.replanReasons], lastPlan: session.lastPlan } : null;
}

/** @deprecated alias */
export const getDayPlanSessionForTest = getDayPlanSession;

export function noteUnifiedPlanPublished(input: {
	date: string;
	timezone: string;
	plan: UnifiedDayPlan;
	expectedPvKwh: number | null;
	batteryStartSocPct: number | null;
	immersionTargetTempC: number | null;
	replanReasons: string[];
}): { rolloverFrom: DayPlanSession | null } {
	let rolloverFrom: DayPlanSession | null = null;
	if (session && session.date !== input.date) {
		rolloverFrom = session;
		session = null;
	}
	if (!session) {
		session = {
			date: input.date,
			timezone: input.timezone,
			initialPlanId: input.plan.planId,
			initialGeneration: input.plan.generation,
			initialExpectedPvKwh: input.expectedPvKwh,
			batteryStartSocPct: input.batteryStartSocPct,
			plannedImmersionTargetTempC: input.immersionTargetTempC,
			replanReasons: [],
			publishCount: 1,
			lastPlan: input.plan,
		};
		return { rolloverFrom };
	}
	session.publishCount += 1;
	session.lastPlan = input.plan;
	session.replanReasons = [...new Set([...session.replanReasons, ...input.replanReasons])];
	return { rolloverFrom };
}

export function sessionSnapshot(s: DayPlanSession): DayEvalSessionSnapshot {
	return snapshotFromUnifiedSession({
		date: s.date,
		timezone: s.timezone,
		initialPlanId: s.initialPlanId,
		finalPlan: s.lastPlan,
		initialGeneration: s.initialGeneration,
		replanCount: Math.max(0, s.publishCount - 1),
		replanReasons: s.replanReasons,
		initialExpectedPvKwh: s.initialExpectedPvKwh,
		batteryStartSocPct: s.batteryStartSocPct,
		plannedImmersionTargetTempC: s.plannedImmersionTargetTempC,
	});
}

export async function closeSessionIfNeeded(input: {
	sessionToClose: DayPlanSession;
	actuals: DayEvalActuals;
	now: Date;
	dayEvalDir: string;
	pvBiasDir: string;
	thermalDir: string;
	log?: { warn?: (m: string) => void };
}): Promise<void> {
	const snap = sessionSnapshot(input.sessionToClose);
	const result = await closeDayEvaluationOnce({
		dayEvalDir: input.dayEvalDir,
		pvBiasDir: input.pvBiasDir,
		thermalDir: input.thermalDir,
		session: snap,
		actuals: input.actuals,
		now: input.now,
	});
	if (result.error) {
		input.log?.warn?.(`day_evaluation close failed: ${result.error}`);
	}
}
