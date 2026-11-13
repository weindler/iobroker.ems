"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPvBiasLearning = runPvBiasLearning;
const state_util_1 = require("../../ems_light/state_util");
const config_1 = require("./config");
const freeze_1 = require("./freeze");
const history_1 = require("./history");
const math_1 = require("./math");
const snapshot_1 = require("./snapshot");
const alt_source_1 = require("./alt_source");
const alt_source_run_1 = require("./alt_source_run");
async function readForeignNum(host, stateId) {
    return (0, history_1.readStateNum)(host, stateId);
}
async function readLiveRawForecast(host, configStateId, fallbackLocalId) {
    const fromConfig = await readForeignNum(host, configStateId);
    if (fromConfig !== null) {
        return fromConfig;
    }
    const local = await host.getStateAsync(fallbackLocalId);
    return (0, state_util_1.asNum)(local?.val);
}
async function setNumIfValid(host, id, value) {
    if (value !== null && Number.isFinite(value)) {
        await host.setStateAsync(id, { val: Math.round(value * 1000) / 1000, ack: true });
    }
}
async function writePvBiasResult(host, result, actualTodayKwh) {
    await setNumIfValid(host, "learning.pv_bias.bias_today_pct", result.biasTodayPct);
    await setNumIfValid(host, "learning.pv_bias.bias_7d_pct", result.bias7dPct);
    await setNumIfValid(host, "learning.pv_bias.bias_30d_pct", result.bias30dPct);
    await setNumIfValid(host, "learning.pv_bias.bias_14d_pct", result.bias14dPct);
    await setNumIfValid(host, "learning.pv_bias.bias_90d_pct", result.bias90dPct);
    await setNumIfValid(host, "learning.pv_bias.model_bias_pct", result.modelBiasPct);
    await setNumIfValid(host, "learning.pv_bias.applied_bias_pct", result.appliedBiasPct);
    await setNumIfValid(host, "learning.pv_bias.corrected_today_kwh", result.correctedTodayKwh);
    await setNumIfValid(host, "learning.pv_bias.corrected_tomorrow_kwh", result.correctedTomorrowKwh);
    await setNumIfValid(host, "learning.pv_bias.confidence_pct", result.confidencePct);
    await setNumIfValid(host, "learning.pv_bias.raw_today_kwh", result.rawTodayKwh);
    await setNumIfValid(host, "learning.pv_bias.raw_tomorrow_kwh", result.rawTomorrowKwh);
    await setNumIfValid(host, "learning.pv_bias.actual_today_kwh", actualTodayKwh);
    await setNumIfValid(host, "learning.pv_bias.sample_days_30d", result.sampleDays30d);
    await setNumIfValid(host, "learning.pv_bias.sample_days_14d", result.sampleDays14d);
    await setNumIfValid(host, "learning.pv_bias.sample_days_90d", result.sampleDays90d);
    await setNumIfValid(host, "learning.pv_bias.coverage_pct", result.coveragePct);
    await setNumIfValid(host, "learning.pv_bias.stability_pct", result.stabilityPct);
    await host.setStateAsync("learning.pv_bias.last_update_ts", {
        val: new Date().toISOString(),
        ack: true,
    });
    await host.setStateAsync("learning.pv_bias.status", { val: result.status, ack: true });
    await host.setStateAsync("learning.pv_bias.reason", { val: result.reason, ack: true });
}
/**
 * Zweitquelle: Live-Werte, Quellenvergleich und Guard. Der Guard ersetzt nur die korrigierten
 * Planungswerte (corrected_*_kwh) durch den niedrigeren Wert, wenn das Bias-Modell schwach belegt ist.
 */
async function publishAltSourceInfo(host, result, altCfg) {
    const alt = await (0, alt_source_run_1.readAltLive)(host, altCfg);
    await setNumIfValid(host, "learning.pv_bias.alt_today_kwh", alt.today);
    await setNumIfValid(host, "learning.pv_bias.alt_tomorrow_kwh", alt.tomorrow);
    const persist = await (0, snapshot_1.loadDailyPersist)(host);
    const cmp = (0, alt_source_1.buildSourceCompare)(persist);
    const unguardedToday = result.correctedTodayKwh;
    const unguardedTomorrow = result.correctedTomorrowKwh;
    let guardStatus = "none";
    if (!altCfg.guardEnabled) {
        guardStatus = "none: Guard in Admin deaktiviert";
    }
    else {
        const guard = (0, alt_source_1.applyAltSourceGuard)({
            correctedTodayKwh: result.correctedTodayKwh,
            correctedTomorrowKwh: result.correctedTomorrowKwh,
            altTodayKwh: alt.today,
            altTomorrowKwh: alt.tomorrow,
            confidencePct: result.confidencePct,
            sampleDays14d: result.sampleDays14d,
        });
        if (guard.guardToday)
            await setNumIfValid(host, "learning.pv_bias.corrected_today_kwh", guard.correctedTodayKwh);
        if (guard.guardTomorrow)
            await setNumIfValid(host, "learning.pv_bias.corrected_tomorrow_kwh", guard.correctedTomorrowKwh);
        guardStatus = guard.guardToday || guard.guardTomorrow ? `active: ${guard.reasonDe}` : `none: ${guard.reasonDe}`;
        if (guard.guardToday || guard.guardTomorrow)
            host.log.debug?.(`PV-Guard: ${guard.reasonDe}`);
    }
    await host.setStateAsync("learning.pv_bias.guard_status", { val: guardStatus, ack: true });
    await host.setStateAsync("learning.pv_bias.compare_json", {
        val: JSON.stringify({
            pairedDays: cmp.pairedDays,
            mainMapePct: cmp.mainMapePct,
            altMapePct: cmp.altMapePct,
            mainBiasPct: cmp.mainBiasPct,
            altBiasPct: cmp.altBiasPct,
            unguardedTodayKwh: unguardedToday,
            unguardedTomorrowKwh: unguardedTomorrow,
            days: cmp.days,
        }),
        ack: true,
    });
}
async function runPvBiasLearning(host) {
    const cfg = (0, config_1.pvBiasConfigFromAdapter)(host.config);
    if (!cfg.enabled) {
        await host.setStateAsync("learning.pv_bias.status", { val: "disabled", ack: true });
        await host.setStateAsync("learning.pv_bias.reason", {
            val: "PV-Bias Learning in Admin deaktiviert.",
            ack: true,
        });
        return;
    }
    if (!(0, config_1.pvBiasConfigReady)(cfg)) {
        await host.setStateAsync("learning.pv_bias.status", { val: "no_config", ack: true });
        await host.setStateAsync("learning.pv_bias.reason", {
            val: cfg.freezeEnabled
                ? "Historie-State für PV-Ist und gültige Freeze-Zeit in Admin konfigurieren."
                : "Historie-States für PV-Ist und PV-Forecast in Admin konfigurieren.",
            ack: true,
        });
        return;
    }
    try {
        await (0, freeze_1.runForecastFreeze)(host, cfg);
        await (0, snapshot_1.backfillDailyPersist)(host, cfg);
        await (0, snapshot_1.runActualDailySnapshot)(host, cfg);
        const altCfg = (0, alt_source_1.altSourceConfigFromAdapter)(host.config);
        try {
            await (0, alt_source_run_1.runAltSourceCapture)(host, cfg, altCfg);
        }
        catch (e) {
            host.log.warn(`PV-Zweitquelle: Erfassung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
        }
        const rawTodayKwh = await readLiveRawForecast(host, cfg.rawTodayStateId, "forecast.pv.today_kwh");
        const rawTomorrowKwh = await readLiveRawForecast(host, cfg.rawTomorrowStateId, "forecast.pv.tomorrow_kwh");
        const frozen = cfg.freezeEnabled ? await (0, freeze_1.readFrozenForecast)(host) : { today: null, tomorrow: null };
        // Forecast-History für vergangene Tage: echte Provider-History (mehrtägig).
        // Der ems-interne Freeze-State hat keine Tiefe → nur als Heute-Override nutzen.
        const forecastHistoryStateId = cfg.historyForecastStateId || cfg.rawTodayStateId || freeze_1.FROZEN_TODAY_STATE_ID;
        const todayForecastOverride = cfg.freezeEnabled ? frozen.today : null;
        host.log.debug?.(`PV-Bias: loading history (90d, actual=${cfg.historyActualStateId || "—"} forecast=${forecastHistoryStateId})…`);
        const dailyPersist = await (0, snapshot_1.loadDailyPersist)(host);
        const dayPairs = await (0, history_1.fetchPvBiasDayPairs)(host, cfg.historyActualStateId, forecastHistoryStateId, {
            maxDays: 90,
            todayForecastOverride,
            dailyPersist,
        });
        const pairs = dayPairs.pairs;
        host.log.debug?.(`PV-Bias: history loaded, ${pairs.length} valid pair(s) (actual_days=${dayPairs.actualDays}, forecast_days=${dayPairs.forecastDays})`);
        if (pairs.length < Math.min(7, dayPairs.actualDays || 7)) {
            const thinSide = dayPairs.forecastDays < dayPairs.actualDays
                ? `Forecast-History dünn (${forecastHistoryStateId} → ${dayPairs.forecastDays}d) — history.0 auf diesem State aktivieren`
                : `Ist-History dünn (${cfg.historyActualStateId} → ${dayPairs.actualDays}d) — history.0 prüfen`;
            host.log.warn(`PV-Bias: nur ${pairs.length} Paar(e) — ${thinSide}.`);
        }
        if (pairs.length === 0) {
            const liveActual = await (0, history_1.readStateNum)(host, cfg.historyActualStateId);
            const todayForecast = await (0, history_1.readStateNum)(host, forecastHistoryStateId);
            host.log.warn(`PV-Bias: no pairs — today live actual=${liveActual ?? "—"} forecast=${todayForecast ?? "—"} (Historie am Alias + Provider-Forecast empfohlen)`);
        }
        const forecastForCorrection = cfg.freezeEnabled
            ? { today: frozen.today, tomorrow: frozen.tomorrow }
            : { today: rawTodayKwh, tomorrow: rawTomorrowKwh };
        const result = (0, math_1.computePvBias)(pairs, forecastForCorrection.today, forecastForCorrection.tomorrow);
        if (cfg.freezeEnabled && frozen.today === null) {
            result.status = "insufficient_data";
            result.reason = "Eingefrorener Forecast fehlt — Bias/Korrektur warten auf Freeze-Snapshot.";
        }
        const todayActual = pairs.find((p) => p.dayOffset === 0)?.actualKwh ??
            (await (0, history_1.readStateNum)(host, cfg.historyActualStateId));
        await writePvBiasResult(host, result, todayActual);
        try {
            await publishAltSourceInfo(host, result, altCfg);
        }
        catch (e) {
            host.log.warn(`PV-Zweitquelle: Auswertung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
        }
        host.log.debug?.(`PV-Bias: 14d=${result.bias14dPct ?? "—"}% 90d=${result.bias90dPct ?? "—"}% model=${result.modelBiasPct ?? "—"}% applied=${result.appliedBiasPct ?? "—"}% conf=${result.confidencePct}% samples=${result.sampleDays90d} freeze=${cfg.freezeEnabled}`);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        host.log.error(`PV-Bias Learning: ${msg}`);
        await host.setStateAsync("learning.pv_bias.status", { val: "error", ack: true });
        await host.setStateAsync("learning.pv_bias.reason", {
            val: `Fehler bei PV-Bias-Berechnung: ${msg}`,
            ack: true,
        });
    }
}
