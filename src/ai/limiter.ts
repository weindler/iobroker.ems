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

function localMonthKey(now: Date): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	return `${y}-${m}`;
}

export interface DailyLimitState {
	callsToday: number;
	limit: number;
	limitReached: boolean;
	softWarning: boolean;
	costTodayEur: number;
	costMonthEur: number;
	monthlyLimitEur: number;
	monthlyLimitReached: boolean;
}

async function rolloverMonth(
	host: LimiterHost,
	now: Date,
): Promise<{ costMonthEur: number; monthKey: string }> {
	const month = localMonthKey(now);
	const stored = String((await host.getStateAsync(AI_STATES.costMonthKey))?.val ?? "");
	let costMonthEur = asNum((await host.getStateAsync(AI_STATES.costEstimateMonthEur))?.val) ?? 0;
	if (stored !== month) {
		costMonthEur = 0;
		await host.setStateAsync(AI_STATES.costMonthKey, { val: month, ack: true });
		await host.setStateAsync(AI_STATES.costEstimateMonthEur, { val: 0, ack: true });
	}
	return { costMonthEur, monthKey: month };
}

/** Liest Tageszähler + Kostenschätzung und setzt bei Tages-/Monatswechsel zurück. */
export async function readAndRolloverDailyCalls(
	host: LimiterHost,
	maxCallsPerDay: number,
	now: Date = new Date(),
	monthlyCostLimitEur = 0,
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

	const { costMonthEur } = await rolloverMonth(host, now);
	const monthlyLimitEur = monthlyCostLimitEur > 0 ? monthlyCostLimitEur : 0;
	const monthlyLimitReached = monthlyLimitEur > 0 && costMonthEur >= monthlyLimitEur;
	const limitReached = callsToday >= maxCallsPerDay || monthlyLimitReached;
	const softWarning = !limitReached && callsToday >= Math.floor(maxCallsPerDay * AI_SOFT_WARNING_FRACTION);

	await host.setStateAsync(AI_STATES.callsLimit, { val: maxCallsPerDay, ack: true });
	await host.setStateAsync(AI_STATES.limitWarning, { val: softWarning, ack: true });
	await host.setStateAsync(AI_STATES.monthlyCostLimitEur, { val: monthlyLimitEur, ack: true });

	return {
		callsToday,
		limit: maxCallsPerDay,
		limitReached,
		softWarning,
		costTodayEur,
		costMonthEur,
		monthlyLimitEur,
		monthlyLimitReached,
	};
}

/** Zählt einen tatsächlich durchgeführten KI-Call + addiert Kostenschätzung (Tag + Monat). */
export async function recordDailyCall(
	host: LimiterHost,
	maxCallsPerDay: number,
	addCostEur: number,
	now: Date = new Date(),
	monthlyCostLimitEur = 0,
): Promise<DailyLimitState> {
	const state = await readAndRolloverDailyCalls(host, maxCallsPerDay, now, monthlyCostLimitEur);
	const callsToday = state.callsToday + 1;
	const costTodayEur = Math.round((state.costTodayEur + addCostEur) * 100_000) / 100_000;
	const costMonthEur = Math.round((state.costMonthEur + addCostEur) * 100_000) / 100_000;
	await host.setStateAsync(AI_STATES.callsToday, { val: callsToday, ack: true });
	await host.setStateAsync(AI_STATES.costEstimateTodayEur, { val: costTodayEur, ack: true });
	await host.setStateAsync(AI_STATES.costEstimateMonthEur, { val: costMonthEur, ack: true });
	const monthlyLimitEur = monthlyCostLimitEur > 0 ? monthlyCostLimitEur : 0;
	const monthlyLimitReached = monthlyLimitEur > 0 && costMonthEur >= monthlyLimitEur;
	const limitReached = callsToday >= maxCallsPerDay || monthlyLimitReached;
	const softWarning = !limitReached && callsToday >= Math.floor(maxCallsPerDay * AI_SOFT_WARNING_FRACTION);
	await host.setStateAsync(AI_STATES.limitWarning, { val: softWarning, ack: true });
	return {
		callsToday,
		limit: maxCallsPerDay,
		limitReached,
		softWarning,
		costTodayEur,
		costMonthEur,
		monthlyLimitEur,
		monthlyLimitReached,
	};
}
