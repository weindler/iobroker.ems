"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runGridBalanceEconomicsLearning = void 0;
const constants_1 = require("../day_telemetry/constants");
const persist_1 = require("../day_telemetry/persist");
const time_1 = require("../../operator/time");
const alpha_beta_1 = require("./alpha_beta");
const constants_2 = require("./constants");
const eta_path_1 = require("./eta_path");
const ensure_states_1 = require("./ensure_states");
const persist_2 = require("./persist");
const windows_from_day_1 = require("./windows_from_day");
async function publish(host, id, val) {
    try {
        await host.setStateAsync(id, { val, ack: true });
    }
    catch {
        /* best-effort */
    }
}
async function runGridBalanceEconomicsLearning(host, opts = {}) {
    const now = opts.now ?? new Date();
    const timezone = opts.timezone ?? "Europe/Berlin";
    const generatedAt = now.toISOString();
    const dir = (0, persist_2.gridBalanceEconomicsDirFromHost)(host.getAbsolutePath);
    const telemetryDir = host.getAbsolutePath?.(constants_1.DAY_TELEMETRY_CATEGORY);
    if (!dir || !telemetryDir) {
        const cold = (0, persist_2.coldStartPersist)(generatedAt);
        if (dir)
            await (0, persist_2.writeGridBalanceEconomicsPersist)(dir, cold);
        await publishLearning(host, cold);
        return;
    }
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const oldestKey = (0, time_1.addDaysToDateKey)(todayKey, -(constants_2.LOOKBACK_DAYS - 1));
    let keys = [];
    try {
        keys = (await (0, persist_1.listDayTelemetryDateKeys)(telemetryDir)).filter((k) => k >= oldestKey && k <= todayKey);
    }
    catch (e) {
        host.log?.warn?.(`grid_balance_economics: day_telemetry nicht lesbar (${e instanceof Error ? e.message : String(e)})`);
    }
    const windows = [];
    const sessions = [];
    for (const key of keys) {
        const day = await (0, persist_1.readDayTelemetryDay)(telemetryDir, key);
        if (!day)
            continue;
        windows.push(...(0, windows_from_day_1.collectMatchWindows)(day));
        sessions.push(...(0, eta_path_1.sessionsFromChargeSlots)({
            chargedKwh: day.buckets.batteryChargedKwh,
            dischargedKwh: day.buckets.batteryDischargedKwh,
            source: (day.buckets.batteryChargeSource ?? []),
        }));
    }
    const alphaBeta = (0, alpha_beta_1.learnAlphaBeta)((0, alpha_beta_1.filterWindowsByLookback)(windows, now.getTime()));
    const eta = (0, eta_path_1.learnEtaPaths)(sessions);
    const persist = {
        module: "grid_balance_economics",
        schemaVersion: 1,
        generatedAt,
        alphaBeta,
        eta,
    };
    await (0, persist_2.writeGridBalanceEconomicsPersist)(dir, persist);
    await publishLearning(host, persist);
}
exports.runGridBalanceEconomicsLearning = runGridBalanceEconomicsLearning;
async function publishLearning(host, persist) {
    const a = persist.alphaBeta;
    const e = persist.eta;
    const S = ensure_states_1.GRID_BALANCE_ECONOMICS_STATE_IDS;
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
