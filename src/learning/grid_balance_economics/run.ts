import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";
import { DAY_TELEMETRY_CATEGORY } from "../day_telemetry/constants";
import { listDayTelemetryDateKeys, readDayTelemetryDay } from "../day_telemetry/persist";
import { addDaysToDateKey, localDateKeyInTimezone } from "../../operator/time";
import { learnAlphaBeta, filterWindowsByLookback, type MatchWindow } from "./alpha_beta";
import { LOOKBACK_DAYS } from "./constants";
import { etaFromBalance, type BalanceDay } from "./eta_balance";
import { batteryConfigFromAdapter } from "../../addons/battery/config";
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

/** Je Tag fertig abgeleitete Werte (klein). Abgeschlossene Tage werden gecacht, damit nicht jede Stunde bis zu 45 Tagesdateien komplett geparst werden (Speicherspitze). */
type DayDerived = { windows: MatchWindow[]; sessions: ChargeDischargeSession[]; balance: BalanceDay | null };
type DaysCache = { version: 1; days: Record<string, DayDerived> };
const DAYS_CACHE_FILE = "days_cache_v1.json";
/** Tage ab dieser Tiefe (in Tagen vor heute) gelten als abgeschlossen. */
const CACHE_SETTLED_DAYS = 2;

async function readDaysCache(file: string): Promise<DaysCache> {
	const empty: DaysCache = { version: 1, days: {} };
	try {
		const parsed = JSON.parse(await fs.readFile(file, "utf8")) as DaysCache;
		if (parsed?.version === 1 && parsed.days && typeof parsed.days === "object") return parsed;
	} catch {
		/* kein oder defekter Cache: neu aufbauen */
	}
	return empty;
}

function deriveDay(day: NonNullable<Awaited<ReturnType<typeof readDayTelemetryDay>>>, key: string, includeBalance: boolean): DayDerived {
	let balance: BalanceDay | null = null;
	if (includeBalance) {
		const sum = (a: Array<number | null>): number | null => {
			let t = 0;
			let n = 0;
			for (const v of a) if (typeof v === "number" && Number.isFinite(v)) { t += v; n += 1; }
			return n ? t : null;
		};
		const soc = day.buckets.batterySocEndPct ?? [];
		const socVals = soc.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
		balance = {
			dateKey: key,
			chargedKwh: sum(day.buckets.batteryChargedKwh),
			dischargedKwh: sum(day.buckets.batteryDischargedKwh),
			socFirstPct: socVals.length ? socVals[0]! : null,
			socLastPct: socVals.length ? socVals[socVals.length - 1]! : null,
			socCoverage: soc.length ? socVals.length / soc.length : 0,
		};
	}
	return {
		windows: collectMatchWindows(day),
		sessions: sessionsFromChargeSlots({
			chargedKwh: day.buckets.batteryChargedKwh,
			dischargedKwh: day.buckets.batteryDischargedKwh,
			source: (day.buckets.batteryChargeSource ?? []) as Array<ChargeSource | null>,
		}),
		balance,
	};
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
	const balanceDays: BalanceDay[] = [];
	const cacheFile = path.join(dir, DAYS_CACHE_FILE);
	const cache = await readDaysCache(cacheFile);
	const settledKey = addDaysToDateKey(todayKey, -CACHE_SETTLED_DAYS);
	let cacheDirty = false;
	for (const key of keys) {
		const settled = key <= settledKey;
		let derived: DayDerived | undefined = settled ? cache.days[key] : undefined;
		if (!derived) {
			const day = await readDayTelemetryDay(telemetryDir, key);
			if (!day) continue;
			derived = deriveDay(day, key, key < todayKey);
			if (settled) {
				cache.days[key] = derived;
				cacheDirty = true;
			}
		}
		if (derived.balance) balanceDays.push(derived.balance);
		windows.push(...derived.windows);
		sessions.push(...derived.sessions);
	}
	for (const k of Object.keys(cache.days)) {
		if (k < oldestKey) {
			delete cache.days[k];
			cacheDirty = true;
		}
	}
	if (cacheDirty) {
		try {
			await fs.mkdir(dir, { recursive: true });
			await atomicWriteFile(cacheFile, JSON.stringify(cache));
		} catch (e) {
			host.log?.debug?.(`grid_balance_economics: Cache nicht geschrieben (${e instanceof Error ? e.message : String(e)})`);
		}
	}

	const alphaBeta = learnAlphaBeta(filterWindowsByLookback(windows, now.getTime()));
	let eta = learnEtaPaths(sessions);
	if (!eta.etaPvUsable || !eta.etaGridUsable) {
		const bal = etaFromBalance(balanceDays, batteryConfigFromAdapter(host.config).capacityManualKwh);
		if (bal.eta !== null) {
			eta = {
				...eta,
				etaPvPath: eta.etaPvUsable ? eta.etaPvPath : bal.eta,
				etaGridPath: eta.etaGridUsable ? eta.etaGridPath : bal.eta,
				etaPvUsable: true,
				etaGridUsable: true,
				reasonDe: bal.reasonDe,
			};
		} else {
			eta = { ...eta, reasonDe: `${eta.reasonDe} ${bal.reasonDe}` };
		}
	}
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
