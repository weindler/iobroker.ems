/**
 * PHASE 3 — Shared-Power/Climate Learning: Orchestrierung.
 *
 * Baut die Statistik bei jedem Lauf komplett aus den `ClimateRunSegment`s der Day-Telemetry-
 * Retention neu auf (kein inkrementelles Fortschreiben, analog `battery_runtime`) — robust
 * gegen Nachträge/Recovery, kein Drift zwischen Zuständen. Liest NUR day_telemetry, schreibt
 * ausschließlich in die eigene Persistenz/States dieses Moduls — kein Fremd-Write.
 */

import { DAY_TELEMETRY_CATEGORY, DAY_TELEMETRY_RETENTION_DAYS } from "../day_telemetry/constants";
import { listDayTelemetryDateKeys, readDayTelemetryDay } from "../day_telemetry/persist";
import { addDaysToDateKey, localDateKeyInTimezone } from "../../operator/time";
import type { StateHost } from "../../ems_light/state_util";
import { computeClimateSharedPowerStats, type ClimateSharedPowerSampleInput } from "./math";
import { climateSharedPowerStateSlug, ensureClimateSharedPowerRootStates, ensureClimateSharedPowerStatesForSlug, publishClimateSharedPowerStat } from "./ensure_states";
import { readClimateSharedPowerPersist, writeClimateSharedPowerPersist } from "./persist";
import type { ClimateSharedPowerPersist } from "./types";

export const CLIMATE_SHARED_POWER_PERSIST_CATEGORY = "learning/climate_shared_power";

export type ClimateSharedPowerHost = StateHost & {
	getAbsolutePath: (category?: string) => string;
	config?: unknown;
	log?: { warn?: (m: string) => void; debug?: (m: string) => void; error?: (m: string) => void };
};

function timezoneFromConfig(config: unknown): string {
	const tz = typeof (config as Record<string, unknown>)?.timezone === "string"
		? ((config as Record<string, unknown>).timezone as string).trim()
		: "";
	return tz || "Europe/Berlin";
}

function labelForKey(groupId: string, mode: string, combo: string): string {
	return `${groupId} ${mode.toUpperCase()} ${combo}`;
}

export async function runClimateSharedPowerLearning(
	host: ClimateSharedPowerHost,
	opts: { now?: Date } = {},
): Promise<ClimateSharedPowerPersist> {
	const now = opts.now ?? new Date();
	const nowMs = now.getTime();
	const timezone = timezoneFromConfig(host.config);
	const todayKey = localDateKeyInTimezone(now, timezone);
	const cutoffKey = addDaysToDateKey(todayKey, -(DAY_TELEMETRY_RETENTION_DAYS - 1));

	const telemetryDir = host.getAbsolutePath(DAY_TELEMETRY_CATEGORY);
	const persistDir = host.getAbsolutePath(CLIMATE_SHARED_POWER_PERSIST_CATEGORY);

	let stats: ClimateSharedPowerPersist["stats"] = {};
	try {
		const allKeys = (await listDayTelemetryDateKeys(telemetryDir)).filter(
			(k) => k >= cutoffKey && k <= todayKey,
		);
		const samples: ClimateSharedPowerSampleInput[] = [];
		for (const dateKey of allKeys) {
			const day = await readDayTelemetryDay(telemetryDir, dateKey);
			if (!day?.climateRunSegments?.length) continue;
			for (const seg of day.climateRunSegments) {
				samples.push({
					sharedPowerGroupId: seg.sharedPowerGroupId,
					mode: seg.mode,
					activeUnitCombination: seg.activeUnitCombination,
					energyKwh: seg.energyKwh,
					runtimeSec: seg.runtimeSec,
					valid: seg.valid,
					endTs: seg.endTs,
				});
			}
		}
		stats = computeClimateSharedPowerStats(samples, nowMs);
	} catch (e) {
		host.log?.warn?.(`climate_shared_power: Learning-Lauf fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
		const existing = await readClimateSharedPowerPersist(persistDir);
		return existing;
	}

	const persisted = await writeClimateSharedPowerPersist(persistDir, stats);
	try {
		await ensureClimateSharedPowerRootStates(host);
		const entries = Object.values(stats);
		const bits = entries
			.slice(0, 4)
			.map((s) => {
				const p75 = s.p75PowerW !== null ? `${Math.round(s.p75PowerW)} W` : "n/a";
				const conf = Math.round(s.confidence * 100);
				return `${s.mode.toUpperCase()} ${s.activeUnitCombination} p75=${p75} (${conf} %)`;
			});
		await host.setStateAsync("learning.climate_shared_power.combinations_count", {
			val: entries.length,
			ack: true,
		});
		await host.setStateAsync("learning.climate_shared_power.summary_de", {
			val: bits.length > 0 ? `${entries.length} Kombination(en) · ${bits.join(" · ")}` : "Noch keine belastbare Shared-Power-Kombination.",
			ack: true,
		});
	} catch (e) {
		host.log?.warn?.(`climate_shared_power: Root-States: ${e instanceof Error ? e.message : String(e)}`);
	}

	for (const stat of Object.values(stats)) {
		const slug = climateSharedPowerStateSlug(stat.sharedPowerGroupId, stat.mode, stat.activeUnitCombination);
		const label = labelForKey(stat.sharedPowerGroupId, stat.mode, stat.activeUnitCombination);
		try {
			await ensureClimateSharedPowerStatesForSlug(host, slug, label);
			await publishClimateSharedPowerStat(host, slug, stat);
		} catch (e) {
			host.log?.warn?.(`climate_shared_power: State-Publish für ${slug} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	return persisted;
}

export async function loadClimateSharedPowerStats(
	host: Pick<ClimateSharedPowerHost, "getAbsolutePath">,
): Promise<ClimateSharedPowerPersist> {
	const persistDir = host.getAbsolutePath(CLIMATE_SHARED_POWER_PERSIST_CATEGORY);
	return readClimateSharedPowerPersist(persistDir);
}
