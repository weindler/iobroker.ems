import type { ContributionsReadHost } from "../contributions/read";

type DeferredForecastWrite = {
	host: ContributionsReadHost;
	run: () => Promise<void>;
};

let pending: DeferredForecastWrite | null = null;

export function scheduleDeferredForecastPlanWrite(
	host: ContributionsReadHost,
	run: () => Promise<void>,
): void {
	pending = { host, run };
}

export function clearDeferredForecastPlanWriteForTest(): void {
	pending = null;
}

export function hasDeferredForecastPlanWrite(): boolean {
	return pending !== null;
}

/** Runs a previously deferred forecast JSON write (e.g. after adapter ready). */
export async function flushDeferredForecastPlanWrites(): Promise<void> {
	const job = pending;
	pending = null;
	if (!job) return;
	await job.run();
}
