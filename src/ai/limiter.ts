import { asNum } from "../ems_light/state_util";
import { AI_SOFT_WARNING_FRACTION } from "./config";
import { AI_STATES } from "./ensure_states";

export type LimiterHost = {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
};

/** Kalendertag in Hauszeitzone (Default Europe/Berlin) — YYYY-MM-DD. */
export function localDateKey(now: Date, timeZone = "Europe/Berlin"): string {
	try {
		return new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(now);
	} catch {
		const y = now.getFullYear();
		const m = String(now.getMonth() + 1).padStart(2, "0");
		const d = String(now.getDate()).padStart(2, "0");
		return `${y}-${m}-${d}`;
	}
}

export function localMonthKey(now: Date, timeZone = "Europe/Berlin"): string {
	return localDateKey(now, timeZone).slice(0, 7);
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
	/** true wenn gerade auf einen neuen lokalen Tag zurückgesetzt wurde */
	rolledOver: boolean;
}

/**
 * Tagesbezogene KI-Anzeige/Prefs nach Mitternacht leeren — damit VIS nicht gestrige
 * Denkspur/Begründung als „aktuell“ zeigt und Auto-Sperre den neuen Tag nicht blockiert.
 */
async function clearPreviousDayAiDisplay(host: LimiterHost): Promise<void> {
	await host.setStateAsync(AI_STATES.lastThinkingDe, { val: "", ack: true });
	await host.setStateAsync(AI_STATES.lastReasonDe, { val: "", ack: true });
	await host.setStateAsync(AI_STATES.lastDecisionsJson, { val: "[]", ack: true });
	await host.setStateAsync(AI_STATES.lastSlotPreferencesJson, { val: "[]", ack: true });
	await host.setStateAsync(AI_STATES.lastRunResult, { val: "", ack: true });
	await host.setStateAsync(AI_STATES.lastError, { val: "", ack: true });
	await host.setStateAsync(AI_STATES.lastThinkingMode, { val: false, ack: true });
	await host.setStateAsync(AI_STATES.autoSuspended, { val: false, ack: true });
	await host.setStateAsync(AI_STATES.autoSuspendReasonDe, { val: "", ack: true });
}

async function rolloverMonth(
	host: LimiterHost,
	now: Date,
	timeZone: string,
): Promise<{ costMonthEur: number; monthKey: string }> {
	const month = localMonthKey(now, timeZone);
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
	timeZone = "Europe/Berlin",
): Promise<DailyLimitState> {
	const today = localDateKey(now, timeZone);
	const storedDate = String((await host.getStateAsync(AI_STATES.callsTodayDate))?.val ?? "");
	let callsToday = asNum((await host.getStateAsync(AI_STATES.callsToday))?.val) ?? 0;
	let costTodayEur = asNum((await host.getStateAsync(AI_STATES.costEstimateTodayEur))?.val) ?? 0;
	let rolledOver = false;

	if (storedDate !== today) {
		rolledOver = true;
		callsToday = 0;
		costTodayEur = 0;
		await host.setStateAsync(AI_STATES.callsTodayDate, { val: today, ack: true });
		await host.setStateAsync(AI_STATES.callsToday, { val: 0, ack: true });
		await host.setStateAsync(AI_STATES.costEstimateTodayEur, { val: 0, ack: true });
		await clearPreviousDayAiDisplay(host);
	}

	const { costMonthEur } = await rolloverMonth(host, now, timeZone);
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
		rolledOver,
	};
}

/** Zählt einen tatsächlich durchgeführten KI-Call + addiert Kostenschätzung (Tag + Monat). */
export async function recordDailyCall(
	host: LimiterHost,
	maxCallsPerDay: number,
	addCostEur: number,
	now: Date = new Date(),
	monthlyCostLimitEur = 0,
	timeZone = "Europe/Berlin",
): Promise<DailyLimitState> {
	const state = await readAndRolloverDailyCalls(host, maxCallsPerDay, now, monthlyCostLimitEur, timeZone);
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
		rolledOver: state.rolledOver,
	};
}
