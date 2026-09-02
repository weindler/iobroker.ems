import { DAY_TELEMETRY_CATEGORY } from "../day_telemetry/constants";
import { listDayTelemetryDateKeys, readDayTelemetryDay } from "../day_telemetry/persist";
import { addDaysToDateKey, localDateKeyInTimezone } from "../../operator/time";
import { learnAlphaBeta, filterWindowsByLookback, type MatchWindow } from "./alpha_beta";
import { LOOKBACK_DAYS } from "./constants";
import { learnEtaPaths, sessionsFromChargeSlots, type ChargeDischargeSession } from "./eta_path";
import { GRID_BALANCE_ECONOMICS_STATE_IDS } from "./ensure_states";
import { coldStartPersist, gridBalanceEconomicsDirFromHost, writeGridBalanceEconomicsPersist } from "./persist";
import type { ChargeSource } from "./types";
import { collectMatchWindows } from "./windows_from_day";

export type GridBalanceEconomicsRunHost = {
	getAbsolutePath?: (category?: string) => string;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	config?: unknown;
	log?: { warn?: (m: string) => void; debug?: (m: string) => void; error?: (m: string) => void };
};

async function publish(
	host: GridBalanceEconomicsRunHost,
	id: string,
	val: ioBroker.StateValue,
): Promise<void> {
	try {
		await host.setStateAsync(id, { val, ack: true });
	} catch {
		/* best-effort */
	}
}

export async function runGridBalanceEconomicsLearning(
	host: GridBalanceEconomicsRunHost,
	opts: { now?: Date; timezone?: string } = {},
): Promise<void> {
	const now = opts.now ?? new Date();
	const timezone = opts.timezone ?? "Europe/Berlin";
	const generatedAt = now.toISOString();
	const dir = gridBalanceEconomicsDirFromHost(host.getAbsolutePath);
	const telemetryDir = host.getAbsolutePath?.(DAY_TELEMETRY_CATEGORY);

	if (!dir || !telemetryDir) {
		const cold = coldStartPersist(generatedAt);
		if (dir) await writeGridBalanceEconomicsPersist(dir, cold);
		await publishLearning(host, cold);
		return;
	}

	const todayKey = localDateKeyInTimezone(now, timezone);
	const oldestKey = addDaysToDateKey(todayKey, -(LOOKBACK_DAYS - 1));
	let keys: string[] = [];
	try {
		keys = (await listDayTelemetryDateKeys(telemetryDir)).filter((k) => k >= oldestKey && k <= todayKey);
	} catch (e) {
		host.log?.warn?.(
			`grid_balance_economics: day_telemetry nicht lesbar (${e instanceof Error ? e.message : String(e)})`,
		);
	}

	const windows: MatchWindow[] = [];
	const sessions: ChargeDischargeSession[] = [];
	for (const key of keys) {
		const day = await readDayTelemetryDay(telemetryDir, key);
		if (!day) continue;
		windows.push(...collectMatchWindows(day));
		sessions.push(
			...sessionsFromChargeSlots({
				chargedKwh: day.buckets.batteryChargedKwh,
				dischargedKwh: day.buckets.batteryDischargedKwh,
				source: (day.buckets.batteryChargeSource ?? []) as Array<ChargeSource | null>,
			}),
		);
	}

	const alphaBeta = learnAlphaBeta(filterWindowsByLookback(windows, now.getTime()));
	const eta = learnEtaPaths(sessions);
	const persist = {
		module: "grid_balance_economics" as const,
		schemaVersion: 1 as const,
		generatedAt,
		alphaBeta,
		eta,
	};
	await writeGridBalanceEconomicsPersist(dir, persist);
	await publishLearning(host, persist);
}

async function publishLearning(
	host: GridBalanceEconomicsRunHost,
	persist: {
		generatedAt: string;
		alphaBeta: import("./types").AlphaBetaLearning;
		eta: import("./types").EtaPathLearning;
	},
): Promise<void> {
	const a = persist.alphaBeta;
	const e = persist.eta;
	const S = GRID_BALANCE_ECONOMICS_STATE_IDS;
	await publish(host, S.status, a.usable ? "usable" : "not_usable");
	await publish(host, S.lastRun, persist.generatedAt);
	await publish(host, S.usable, a.usable);
	await publish(host, S.alpha, a.alpha);
	await publish(host, S.beta, a.beta);
	await publish(host, S.confidence, a.confidence);
	await publish(host, S.pairCount, a.pairCount);
	await publish(host, S.reasonDe, a.reasonDe);
	await publish(host, S.etaPvPath, e.etaPvPath);
	await publish(host, S.etaGridPath, e.etaGridPath);
	await publish(host, S.etaPvUsable, e.etaPvUsable);
	await publish(host, S.etaGridUsable, e.etaGridUsable);
	await publish(host, S.etaReasonDe, e.reasonDe);
}
