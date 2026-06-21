"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBatteryRuntimeLearning = void 0;
const config_1 = require("./config");
const history_1 = require("./history");
const mapping_1 = require("./mapping");
const math_1 = require("./math");
const persist_1 = require("./persist");
async function setNumIfValid(host, id, value) {
    if (value !== null && Number.isFinite(value)) {
        await host.setStateAsync(id, { val: value, ack: true });
    }
}
async function writeResult(host, result, lastRun) {
    await host.setStateAsync("learning.battery_runtime.status", { val: result.status, ack: true });
    await host.setStateAsync("learning.battery_runtime.last_run", { val: lastRun, ack: true });
    await setNumIfValid(host, "learning.battery_runtime.sample_days", result.sampleDays);
    await setNumIfValid(host, "learning.battery_runtime.avg_night_discharge_pct", result.avgNightDischargePct);
    await setNumIfValid(host, "learning.battery_runtime.avg_night_discharge_kwh", result.avgNightDischargeKwh);
    await setNumIfValid(host, "learning.battery_runtime.avg_charge_rate_pct_h", result.avgChargeRatePctH);
    await setNumIfValid(host, "learning.battery_runtime.avg_discharge_rate_pct_h", result.avgDischargeRatePctH);
    await setNumIfValid(host, "learning.battery_runtime.avg_charge_power_w", result.avgChargePowerW);
    await setNumIfValid(host, "learning.battery_runtime.avg_discharge_power_w", result.avgDischargePowerW);
    await setNumIfValid(host, "learning.battery_runtime.max_charge_power_w", result.maxChargePowerW);
    await setNumIfValid(host, "learning.battery_runtime.max_discharge_power_w", result.maxDischargePowerW);
    await host.setStateAsync("learning.battery_runtime.last_full_charge", {
        val: result.lastFullCharge ?? "",
        ack: true,
    });
    await setNumIfValid(host, "learning.battery_runtime.days_since_full", result.daysSinceFull);
    await setNumIfValid(host, "learning.battery_runtime.topoff_interval_days", result.topoffIntervalDays);
    await setNumIfValid(host, "learning.battery_runtime.topoff_days_remaining", result.topoffDaysRemaining);
    if (result.topoffDue !== null) {
        await host.setStateAsync("learning.battery_runtime.topoff_due", {
            val: result.topoffDue ? 1 : 0,
            ack: true,
        });
    }
    await setNumIfValid(host, "learning.battery_runtime.estimated_runtime_days", result.estimatedRuntimeDays);
}
async function runBatteryRuntimeLearning(host) {
    const cfg = (0, config_1.batteryRuntimeConfigFromAdapter)(host.config);
    const now = new Date();
    const lastRun = now.toISOString();
    if (!cfg.enabled) {
        await writeResult(host, (0, math_1.disabledResult)(cfg), lastRun);
        return;
    }
    const sources = await (0, mapping_1.resolveBatteryRuntimeSources)(host, {
        socStateId: cfg.socStateId,
        powerStateId: cfg.powerStateId,
        capacityStateId: cfg.capacityStateId,
    });
    if (!sources.socStateId) {
        await writeResult(host, (0, math_1.noSourceResult)(cfg), lastRun);
        return;
    }
    try {
        const [socHist, powerHist, capacityKwh, currentSocPct, astroDaily] = await Promise.all([
            (0, history_1.fetchSocHistory)(host, sources.socStateId, cfg.lookbackDays),
            sources.powerStateId
                ? (0, history_1.fetchPowerHistory)(host, sources.powerStateId, cfg.lookbackDays, cfg.powerInvert)
                : Promise.resolve({ points: [], lastValidTs: null }),
            (0, history_1.readLiveCapacityKwh)(host, sources.capacityStateId),
            (0, history_1.readLiveSoc)(host, sources.socStateId),
            (0, config_1.nightAstroConfigReady)(cfg)
                ? Promise.all([
                    (0, history_1.fetchAstroTimeHistory)(host, cfg.nightStartStateId, cfg.lookbackDays),
                    (0, history_1.fetchAstroTimeHistory)(host, cfg.nightEndStateId, cfg.lookbackDays),
                ]).then(([startPts, endPts]) => (0, history_1.mergeDailyAstroTimes)(startPts, endPts))
                : Promise.resolve(null),
        ]);
        const sampleDays = (0, history_1.distinctSocSampleDays)(socHist.points);
        const result = (0, math_1.computeBatteryRuntimeLearning)({
            socPoints: socHist.points,
            powerPoints: powerHist.points,
            capacityKwh,
            currentSocPct,
            cfg,
            sourceSocStateId: sources.socStateId,
            sourcePowerStateId: sources.powerStateId,
            now,
            sampleDays,
            astroDaily,
        });
        if (host.getAbsolutePath) {
            await (0, persist_1.writeBatteryRuntimePersist)(host.getAbsolutePath("learning/battery_runtime"), result, lastRun);
        }
        await writeResult(host, result, lastRun);
        host.log.info(`Battery-Runtime-Learning: status=${result.status} nights=${result.avgNightDischargePct ?? "n/a"}% samples=${result.sampleDays} soc=${(0, config_1.sourceLabelFromStateId)(sources.socStateId)}`);
        if (result.status === "insufficient_data") {
            host.log.warn(`Battery Runtime Learning: ungenügende Historie (sample_days=${result.sampleDays}, soc_points=${socHist.points.length})`);
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        host.log.error(`Battery Runtime Learning: ${msg}`);
        await writeResult(host, (0, math_1.errorResult)(msg, cfg, { soc: sources.socStateId, power: sources.powerStateId }), lastRun);
    }
}
exports.runBatteryRuntimeLearning = runBatteryRuntimeLearning;
