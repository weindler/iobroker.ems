import { asNum } from "../ems_light/state_util";
import { AI_SOFT_WARNING_FRACTION } from "./config";
import { AI_STATES } from "./ensure_states";

export type LimiterHost = {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
};

function localDateKey(now: Date): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

export interface DailyLimitState {
	callsToday: number;
	limit: number;
	limitReached: boolean;
	softWarning: boolean;
	costTodayEur: number;
}

/** Liest Tageszähler + Kostenschätzung und setzt beide bei Tageswechsel zurück (kein Timer nötig, prüft bei jedem Zugriff). */
export async function readAndRolloverDailyCalls(
	host: LimiterHost,
	maxCallsPerDay: number,
	now: Date = new Date(),
): Promise<DailyLimitState> {
	const today = localDateKey(now);
	const storedDate = String((await host.getStateAsync(AI_STATES.callsTodayDate))?.val ?? "");
	let callsToday = asNum((await host.getStateAsync(AI_STATES.callsToday))?.val) ?? 0;
	let costTodayEur = asNum((await host.getStateAsync(AI_STATES.costEstimateTodayEur))?.val) ?? 0;

	if (storedDate !== today) {
		callsToday = 0;
		costTodayEur = 0;
		await host.setStateAsync(AI_STATES.callsTodayDate, { val: today, ack: true });
		await host.setStateAsync(AI_STATES.callsToday, { val: 0, ack: true });
		await host.setStateAsync(AI_STATES.costEstimateTodayEur, { val: 0, ack: true });
	}

	const limitReached = callsToday >= maxCallsPerDay;
	const softWarning = !limitReached && callsToday >= Math.floor(maxCallsPerDay * AI_SOFT_WARNING_FRACTION);

	await host.setStateAsync(AI_STATES.callsLimit, { val: maxCallsPerDay, ack: true });
	await host.setStateAsync(AI_STATES.limitWarning, { val: softWarning, ack: true });

	return { callsToday, limit: maxCallsPerDay, limitReached, softWarning, costTodayEur };
}

/** Zählt einen tatsächlich durchgeführten KI-Call (Attempt, unabhängig vom Ergebnis) + addiert Kostenschätzung. */
export async function recordDailyCall(
	host: LimiterHost,
	maxCallsPerDay: number,
	addCostEur: number,
	now: Date = new Date(),
): Promise<DailyLimitState> {
	const state = await readAndRolloverDailyCalls(host, maxCallsPerDay, now);
	const callsToday = state.callsToday + 1;
	const costTodayEur = Math.round((state.costTodayEur + addCostEur) * 100_000) / 100_000;
	await host.setStateAsync(AI_STATES.callsToday, { val: callsToday, ack: true });
	await host.setStateAsync(AI_STATES.costEstimateTodayEur, { val: costTodayEur, ack: true });
	const limitReached = callsToday >= maxCallsPerDay;
	const softWarning = !limitReached && callsToday >= Math.floor(maxCallsPerDay * AI_SOFT_WARNING_FRACTION);
	await host.setStateAsync(AI_STATES.limitWarning, { val: softWarning, ack: true });
	return { callsToday, limit: maxCallsPerDay, limitReached, softWarning, costTodayEur };
}
