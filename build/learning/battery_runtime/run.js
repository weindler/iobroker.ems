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
    await setNumIfValid(host, "learning.battery_runtime.seconds_since_full_charge", result.secondsSinceFullCharge);
    await host.setStateAsync("learning.battery_runtime.full_charge_source", {
        val: result.fullChargeSource ?? "",
        ack: true,
    });
    await setNumIfValid(host, "learning.battery_runtime.topoff_interval_days", result.topoffIntervalDays);
    await setNumIfValid(host, "learning.battery_runtime.topoff_days_remaining", result.topoffDaysRemaining);
    if (result.topoffDue !== null) {
        await host.setStateAsync("learning.battery_runtime.topoff_due", {
            val: result.topoffDue ? 1 : 0,
            ack: true,
        });
    }
    await setNumIfValid(host, "learning.battery_runtime.estimated_runtime_days", result.estimatedRuntimeDays);
    await setNumIfValid(host, "learning.battery_runtime.power_history_raw_rows", result.powerHistoryRawRows);
    await setNumIfValid(host, "learning.battery_runtime.power_history_normalized_rows", result.powerHistoryNormalizedRows);
    await setNumIfValid(host, "learning.battery_runtime.power_raw_charge_samples", result.powerRawChargeSamples);
    await setNumIfValid(host, "learning.battery_runtime.power_raw_discharge_samples", result.powerRawDischargeSamples);
    await setNumIfValid(host, "learning.battery_runtime.power_hourly_charge_points", result.powerHourlyChargePoints);
    await setNumIfValid(host, "learning.battery_runtime.power_hourly_discharge_points", result.powerHourlyDischargePoints);
    if (result.powerInvertApplied !== null) {
        await host.setStateAsync("learning.battery_runtime.power_invert_applied", {
            val: result.powerInvertApplied ? 1 : 0,
            ack: true,
        });
    }
    if (result.powerInvertAuto !== null) {
        await host.setStateAsync("learning.battery_runtime.power_invert_auto", {
            val: result.powerInvertAuto ? 1 : 0,
            ack: true,
        });
    }
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
        secondsSinceFullStateId: cfg.secondsSinceFullStateId,
    });
    if (!sources.socStateId) {
        await writeResult(host, (0, math_1.noSourceResult)(cfg), lastRun);
        return;
    }
    try {
        host.log.info(`Battery-Runtime-Learning: loading history (${cfg.lookbackDays}d, soc=${(0, config_1.sourceLabelFromStateId)(sources.socStateId)})…`);
        const [socHist, secondsSinceFull, capacityKwh, currentSocPct] = await Promise.all([
            (0, history_1.fetchSocHistory)(host, sources.socStateId, cfg.lookbackDays),
            (0, history_1.readSecondsSinceFullCharge)(host, sources.secondsSinceFullStateId),
            (0, history_1.readLiveCapacityKwh)(host, sources.capacityStateId),
            (0, history_1.readLiveSoc)(host, sources.socStateId),
        ]);
        const socRaw = secondsSinceFull === null
            ? await (0, history_1.fetchSocHistoryRaw)(host, sources.socStateId, cfg.lookbackDays)
            : [];
        const powerHist = sources.powerStateId
            ? await (0, history_1.fetchPowerHistory)(host, sources.powerStateId, cfg.lookbackDays, cfg.powerInvert)
            : { points: [], lastValidTs: null, meta: null };
        const astroDaily = (0, config_1.nightAstroConfigReady)(cfg)
            ? (0, history_1.mergeDailyAstroTimes)(await (0, history_1.fetchAstroTimeHistory)(host, cfg.nightStartStateId, cfg.lookbackDays), await (0, history_1.fetchAstroTimeHistory)(host, cfg.nightEndStateId, cfg.lookbackDays))
            : null;
        const sampleDays = (0, history_1.distinctSocSampleDays)(socHist.points);
        const result = (0, math_1.withPowerDiagnostics)((0, math_1.computeBatteryRuntimeLearning)({
            socPoints: socHist.points,
            socPointsForFullCharge: socRaw,
            secondsSinceFull,
            powerPoints: powerHist.points,
            capacityKwh,
            currentSocPct,
            cfg,
            sourceSocStateId: sources.socStateId,
            sourcePowerStateId: sources.powerStateId,
            now,
            sampleDays,
            astroDaily,
        }), powerHist.meta);
        if (host.getAbsolutePath) {
            await (0, persist_1.writeBatteryRuntimePersist)(host.getAbsolutePath("learning/battery_runtime"), result, lastRun);
        }
        await writeResult(host, result, lastRun);
        host.log.info(`Battery-Runtime-Learning: status=${result.status} nights=${result.avgNightDischargePct ?? "n/a"}% samples=${result.sampleDays} full_src=${result.fullChargeSource ?? "—"} sec_since_full=${result.secondsSinceFullCharge ?? "—"} days_since_full=${result.daysSinceFull ?? "—"} last_full=${result.lastFullCharge ?? "—"} soc=${(0, config_1.sourceLabelFromStateId)(sources.socStateId)} power=${(0, config_1.sourceLabelFromStateId)(sources.powerStateId)} invert=${result.powerInvertApplied === null ? "—" : result.powerInvertApplied ? "on" : "off"}${result.powerInvertAuto ? "(auto)" : ""} pwr_raw=${result.powerRawChargeSamples ?? "—"}/${result.powerRawDischargeSamples ?? "—"} pwr_hr=${result.powerHourlyChargePoints ?? "—"}/${result.powerHourlyDischargePoints ?? "—"} avg_chg_w=${result.avgChargePowerW ?? "—"}`);
        if (sources.powerStateId &&
            result.powerRawChargeSamples === 0 &&
            result.powerRawDischargeSamples !== null &&
            result.powerRawDischargeSamples > 0) {
            host.log.warn(`Battery Runtime Learning: keine Lade-Samples in Leistungs-History (raw_charge=0, raw_discharge=${result.powerRawDischargeSamples}, invert=${result.powerInvertApplied ? "on" : "off"}${result.powerInvertAuto ? " auto" : ""}) — pacTotal-History prüfen (negative Werte beim Laden?)`);
        }
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
