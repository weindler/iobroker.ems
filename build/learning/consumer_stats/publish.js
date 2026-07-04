"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishConsumerStats = void 0;
const state_write_1 = require("../../policy/core/state_write");
const ensure_states_1 = require("./ensure_states");
async function publishConsumerStats(host, consumerKey, snapshot) {
    const ids = (0, ensure_states_1.consumerStatsStateIdsForKey)(consumerKey);
    await (0, state_write_1.setStateIfChanged)(host, ids.tracking, snapshot.tracking);
    await (0, state_write_1.setStateIfChanged)(host, ids.deviceActive, snapshot.deviceActive);
    await (0, state_write_1.setStateIfChanged)(host, ids.todayRuntimeSec, snapshot.todayRuntimeSec);
    await (0, state_write_1.setStateIfChanged)(host, ids.todayEnergyKwh, snapshot.todayEnergyKwh);
    await (0, state_write_1.setStateIfChanged)(host, ids.totalRuntimeSec, snapshot.totalRuntimeSec);
    await (0, state_write_1.setStateIfChanged)(host, ids.totalEnergyKwh, snapshot.totalEnergyKwh);
    await (0, state_write_1.setStateIfChanged)(host, ids.sessionRuntimeSec, snapshot.sessionRuntimeSec);
    await (0, state_write_1.setStateIfChanged)(host, ids.sessionEnergyKwh, snapshot.sessionEnergyKwh);
    await (0, state_write_1.setStateIfChanged)(host, ids.lastSessionRuntimeSec, snapshot.lastSessionRuntimeSec);
    await (0, state_write_1.setStateIfChanged)(host, ids.lastSessionEnergyKwh, snapshot.lastSessionEnergyKwh);
    await (0, state_write_1.setStateIfChanged)(host, ids.lastUpdated, snapshot.lastUpdated);
}
exports.publishConsumerStats = publishConsumerStats;
