"use strict";
/**
 * PHASE 3 — Shared-Power/Climate Learning: Orchestrierung.
 *
 * Baut die Statistik bei jedem Lauf komplett aus den `ClimateRunSegment`s der Day-Telemetry-
 * Retention neu auf (kein inkrementelles Fortschreiben, analog `battery_runtime`) — robust
 * gegen Nachträge/Recovery, kein Drift zwischen Zuständen. Liest NUR day_telemetry, schreibt
 * ausschließlich in die eigene Persistenz/States dieses Moduls — kein Fremd-Write.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadClimateSharedPowerStats = exports.runClimateSharedPowerLearning = exports.CLIMATE_SHARED_POWER_PERSIST_CATEGORY = void 0;
const constants_1 = require("../day_telemetry/constants");
const persist_1 = require("../day_telemetry/persist");
const time_1 = require("../../operator/time");
const math_1 = require("./math");
const ensure_states_1 = require("./ensure_states");
const persist_2 = require("./persist");
exports.CLIMATE_SHARED_POWER_PERSIST_CATEGORY = "learning/climate_shared_power";
function timezoneFromConfig(config) {
    const tz = typeof config?.timezone === "string"
        ? config.timezone.trim()
        : "";
    return tz || "Europe/Berlin";
}
function labelForKey(groupId, mode, combo) {
    return `${groupId} ${mode.toUpperCase()} ${combo}`;
}
async function runClimateSharedPowerLearning(host, opts = {}) {
    const now = opts.now ?? new Date();
    const nowMs = now.getTime();
    const timezone = timezoneFromConfig(host.config);
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const cutoffKey = (0, time_1.addDaysToDateKey)(todayKey, -(constants_1.DAY_TELEMETRY_RETENTION_DAYS - 1));
    const telemetryDir = host.getAbsolutePath(constants_1.DAY_TELEMETRY_CATEGORY);
    const persistDir = host.getAbsolutePath(exports.CLIMATE_SHARED_POWER_PERSIST_CATEGORY);
    let stats = {};
    try {
        const allKeys = (await (0, persist_1.listDayTelemetryDateKeys)(telemetryDir)).filter((k) => k >= cutoffKey && k <= todayKey);
        const samples = [];
        for (const dateKey of allKeys) {
            const day = await (0, persist_1.readDayTelemetryDay)(telemetryDir, dateKey);
            if (!day?.climateRunSegments?.length)
                continue;
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
        stats = (0, math_1.computeClimateSharedPowerStats)(samples, nowMs);
    }
    catch (e) {
        host.log?.warn?.(`climate_shared_power: Learning-Lauf fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
        const existing = await (0, persist_2.readClimateSharedPowerPersist)(persistDir);
        return existing;
    }
    const persisted = await (0, persist_2.writeClimateSharedPowerPersist)(persistDir, stats);
    try {
        await (0, ensure_states_1.ensureClimateSharedPowerRootStates)(host);
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
    }
    catch (e) {
        host.log?.warn?.(`climate_shared_power: Root-States: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const stat of Object.values(stats)) {
        const slug = (0, ensure_states_1.climateSharedPowerStateSlug)(stat.sharedPowerGroupId, stat.mode, stat.activeUnitCombination);
        const label = labelForKey(stat.sharedPowerGroupId, stat.mode, stat.activeUnitCombination);
        try {
            await (0, ensure_states_1.ensureClimateSharedPowerStatesForSlug)(host, slug, label);
            await (0, ensure_states_1.publishClimateSharedPowerStat)(host, slug, stat);
        }
        catch (e) {
            host.log?.warn?.(`climate_shared_power: State-Publish für ${slug} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return persisted;
}
exports.runClimateSharedPowerLearning = runClimateSharedPowerLearning;
async function loadClimateSharedPowerStats(host) {
    const persistDir = host.getAbsolutePath(exports.CLIMATE_SHARED_POWER_PERSIST_CATEGORY);
    return (0, persist_2.readClimateSharedPowerPersist)(persistDir);
}
exports.loadClimateSharedPowerStats = loadClimateSharedPowerStats;
