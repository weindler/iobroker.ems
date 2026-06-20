"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readFrozenForecast = exports.runForecastFreeze = exports.buildFreezeSnapshot = exports.decideForecastFreeze = exports.freezeInstantMs = exports.localDateKey = exports.FROZEN_TOMORROW_STATE_ID = exports.FROZEN_TODAY_STATE_ID = void 0;
const state_util_1 = require("../../ems_light/state_util");
const config_1 = require("./config");
exports.FROZEN_TODAY_STATE_ID = "learning.pv_bias.frozen_today_kwh";
exports.FROZEN_TOMORROW_STATE_ID = "learning.pv_bias.frozen_tomorrow_kwh";
/** Lokales Kalenderdatum YYYY-MM-DD. */
function localDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
exports.localDateKey = localDateKey;
/** Zeitpunkt des Freeze heute (lokale Zeit) in ms. */
function freezeInstantMs(freezeTime, ref) {
    const parsed = (0, config_1.parseFreezeTimeHHMM)(freezeTime);
    if (!parsed) {
        return null;
    }
    const d = new Date(ref);
    d.setHours(parsed.hours, parsed.minutes, 0, 0);
    return d.getTime();
}
exports.freezeInstantMs = freezeInstantMs;
/**
 * Entscheidet, ob ein neuer Forecast-Snapshot erstellt werden soll.
 * Maximal ein Freeze pro Kalendertag; Neustart ändert nichts, wenn heute bereits eingefroren.
 */
function decideForecastFreeze(now, freezeEnabled, configuredFreezeTime, frozenAtTs) {
    if (!freezeEnabled) {
        return {
            shouldFreeze: false,
            status: "disabled",
            reason: "Forecast-Freeze in Admin deaktiviert.",
        };
    }
    const freezeMs = freezeInstantMs(configuredFreezeTime, now);
    if (freezeMs === null) {
        return {
            shouldFreeze: false,
            status: "error",
            reason: `Ungültige Freeze-Zeit: ${configuredFreezeTime}`,
        };
    }
    if (now.getTime() < freezeMs) {
        return {
            shouldFreeze: false,
            status: "waiting",
            reason: `Warte auf Freeze um ${configuredFreezeTime}.`,
        };
    }
    if (frozenAtTs) {
        const frozenAt = new Date(frozenAtTs);
        if (!Number.isNaN(frozenAt.getTime()) && localDateKey(frozenAt) === localDateKey(now)) {
            return {
                shouldFreeze: false,
                status: "ready",
                reason: `Forecast bereits um ${frozenAtTs} eingefroren.`,
            };
        }
    }
    return {
        shouldFreeze: true,
        status: "waiting",
        reason: `Erstelle Forecast-Snapshot (${configuredFreezeTime}).`,
    };
}
exports.decideForecastFreeze = decideForecastFreeze;
/** Validiert Live-Forecast vor dem Freeze — fehlende Werte → kein Snapshot, kein 0. */
function buildFreezeSnapshot(now, freezeTime, frozenTodayKwh, frozenTomorrowKwh, frozenSource) {
    if (frozenTodayKwh === null || !Number.isFinite(frozenTodayKwh)) {
        return { ok: false, reason: "Rohforecast heute fehlt — kein Freeze-Snapshot." };
    }
    if (frozenTodayKwh <= 0) {
        return { ok: false, reason: "Rohforecast heute ungültig (≤ 0) — kein Freeze-Snapshot." };
    }
    const tomorrow = frozenTomorrowKwh !== null && Number.isFinite(frozenTomorrowKwh) && frozenTomorrowKwh > 0
        ? frozenTomorrowKwh
        : null;
    return {
        ok: true,
        snapshot: {
            frozenAtTs: now.toISOString(),
            freezeTime,
            frozenTodayKwh,
            frozenTomorrowKwh: tomorrow,
            frozenSource,
        },
    };
}
exports.buildFreezeSnapshot = buildFreezeSnapshot;
async function readForeignNum(host, stateId) {
    if (!stateId) {
        return null;
    }
    try {
        const read = host.getForeignStateAsync ?? host.getStateAsync;
        const st = await read.call(host, stateId);
        return (0, state_util_1.asNum)(st?.val);
    }
    catch {
        return null;
    }
}
async function readLiveRawForecast(host, cfg) {
    const fromTodayConfig = await readForeignNum(host, cfg.rawTodayStateId);
    if (fromTodayConfig !== null) {
        const tomorrow = await readForeignNum(host, cfg.rawTomorrowStateId);
        return { today: fromTodayConfig, tomorrow, source: cfg.rawTodayStateId };
    }
    const localToday = await host.getStateAsync("forecast.pv.today_kwh");
    const today = (0, state_util_1.asNum)(localToday?.val);
    if (today !== null) {
        const localTomorrow = await host.getStateAsync("forecast.pv.tomorrow_kwh");
        return {
            today,
            tomorrow: (0, state_util_1.asNum)(localTomorrow?.val),
            source: "forecast.pv.today_kwh",
        };
    }
    return { today: null, tomorrow: null, source: "—" };
}
async function setNumIfValid(host, id, value) {
    if (value !== null && Number.isFinite(value)) {
        await host.setStateAsync(id, { val: Math.round(value * 1000) / 1000, ack: true });
    }
}
async function writeFreezeMeta(host, status, reason) {
    await host.setStateAsync("learning.pv_bias.freeze_status", { val: status, ack: true });
    await host.setStateAsync("learning.pv_bias.freeze_reason", { val: reason, ack: true });
}
/** Snapshot nur zum konfigurierten Freeze-Zeitpunkt — danach unverändert bis zum nächsten Tag. */
async function runForecastFreeze(host, cfg) {
    await host.setStateAsync("learning.pv_bias.freeze_time", { val: cfg.freezeTime, ack: true });
    const frozenAtSt = await host.getStateAsync("learning.pv_bias.frozen_at_ts");
    const frozenAtTs = typeof frozenAtSt?.val === "string" ? frozenAtSt.val : null;
    const decision = decideForecastFreeze(new Date(), cfg.freezeEnabled, cfg.freezeTime, frozenAtTs);
    if (!cfg.freezeEnabled) {
        await writeFreezeMeta(host, decision.status, decision.reason);
        return;
    }
    if (!decision.shouldFreeze) {
        await writeFreezeMeta(host, decision.status, decision.reason);
        return;
    }
    const live = await readLiveRawForecast(host, cfg);
    const built = buildFreezeSnapshot(new Date(), cfg.freezeTime, live.today, live.tomorrow, live.source);
    if (!built.ok) {
        host.log.warn(`PV-Bias Freeze: ${built.reason}`);
        await writeFreezeMeta(host, "error", built.reason);
        return;
    }
    const snap = built.snapshot;
    await setNumIfValid(host, exports.FROZEN_TODAY_STATE_ID, snap.frozenTodayKwh);
    await setNumIfValid(host, exports.FROZEN_TOMORROW_STATE_ID, snap.frozenTomorrowKwh);
    await host.setStateAsync("learning.pv_bias.frozen_at_ts", { val: snap.frozenAtTs, ack: true });
    await host.setStateAsync("learning.pv_bias.frozen_source", { val: snap.frozenSource, ack: true });
    await writeFreezeMeta(host, "ready", `Forecast-Snapshot um ${snap.frozenAtTs} erstellt.`);
    host.log.info(`PV-Bias Freeze: today=${snap.frozenTodayKwh} kWh source=${snap.frozenSource}`);
}
exports.runForecastFreeze = runForecastFreeze;
async function readFrozenForecast(host) {
    const todaySt = await host.getStateAsync(exports.FROZEN_TODAY_STATE_ID);
    const tomorrowSt = await host.getStateAsync(exports.FROZEN_TOMORROW_STATE_ID);
    return {
        today: (0, state_util_1.asNum)(todaySt?.val),
        tomorrow: (0, state_util_1.asNum)(tomorrowSt?.val),
    };
}
exports.readFrozenForecast = readFrozenForecast;
