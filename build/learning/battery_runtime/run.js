"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBatteryRuntimeLearning = void 0;
const config_1 = require("./config");
const history_1 = require("./history");
const mapping_1 = require("./mapping");
const math_1 = require("./math");
const persist_1 = require("./persist");
const config_2 = require("../pv_bias/config");
async function setNumIfValid(host, id, value) {
    if (value !== null && Number.isFinite(value)) {
        await host.setStateAsync(id, { val: value, ack: true });
    }
}
async function writeResult(host, result, lastRun, diag) {
    await host.setStateAsync("learning.battery_runtime.status", { val: result.status, ack: true });
    await host.setStateAsync("learning.battery_runtime.last_run", { val: lastRun, ack: true });
    await setNumIfValid(host, "learning.battery_runtime.sample_days", result.sampleDays);
    await setNumIfValid(host, "learning.battery_runtime.avg_night_discharge_kwh", result.avgNightDischargeKwh);
    await setNumIfValid(host, "learning.battery_runtime.avg_night_discharge_pct", result.avgNightDischargePct);
    await setNumIfValid(host, "learning.battery_runtime.avg_night_bridge_hours", result.avgNightBridgeHours);
    await host.setStateAsync("learning.battery_runtime.night_bridge_method", {
        val: result.nightBridgeMethod,
        ack: true,
    });
    if (diag) {
        await setNumIfValid(host, "learning.battery_runtime.night_bridge_pv_points", diag.pvPoints);
        await setNumIfValid(host, "learning.battery_runtime.night_bridge_house_points", diag.housePoints);
        if (diag.pvOrigin) {
            await host.setStateAsync("learning.battery_runtime.night_bridge_pv_origin", {
                val: diag.pvOrigin,
                ack: true,
            });
        }
    }
    await setNumIfValid(host, "learning.battery_runtime.avg_charge_power_w", result.avgChargePowerW);
    await setNumIfValid(host, "learning.battery_runtime.max_charge_power_w", result.maxChargePowerW);
    await host.setStateAsync("learning.battery_runtime.last_full_charge", {
        val: result.lastFullCharge ?? "",
        ack: true,
    });
    await setNumIfValid(host, "learning.battery_runtime.days_since_full", result.daysSinceFull);
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
        secondsSinceFullStateId: cfg.secondsSinceFullStateId,
    });
    if (!sources.socStateId) {
        await writeResult(host, (0, math_1.noSourceResult)(cfg), lastRun);
        return;
    }
    try {
        host.log.debug?.(`Battery-Runtime-Learning: loading history (${cfg.lookbackDays}d, soc=${(0, config_1.sourceLabelFromStateId)(sources.socStateId)})…`);
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
        const [pvDirect, housePowerPoints] = await Promise.all([
            sources.pvAcPowerStateId
                ? (0, history_1.fetchSitePowerSeries)(host, sources.pvAcPowerStateId, cfg.lookbackDays)
                : Promise.resolve([]),
            sources.consumptionStateId
                ? (0, history_1.fetchSitePowerSeries)(host, sources.consumptionStateId, cfg.lookbackDays)
                : Promise.resolve([]),
        ]);
        let pvPowerPoints = pvDirect;
        let pvOrigin = pvDirect.length >= history_1.MIN_NIGHT_BRIDGE_SITE_POINTS
            ? "pv_ac"
            : pvDirect.length > 0
                ? "pv_ac_thin"
                : "none";
        if (pvPowerPoints.length < history_1.MIN_NIGHT_BRIDGE_SITE_POINTS) {
            const energyId = (0, config_2.pvBiasConfigFromAdapter)(host.config).historyActualStateId;
            if (energyId) {
                const fromEnergy = await (0, history_1.fetchSitePowerFromEnergyCounter)(host, energyId, cfg.lookbackDays);
                if (fromEnergy.length > pvPowerPoints.length) {
                    pvPowerPoints = fromEnergy;
                    pvOrigin = "day_energy";
                    host.log.info(`Battery-Runtime-Learning: PV-AC-Historie dünn (${pvDirect.length}) — Leistung aus Energiezähler ${(0, config_1.sourceLabelFromStateId)(energyId)} (${fromEnergy.length} Punkte).`);
                }
            }
        }
        const astroDaily = (0, config_1.nightAstroConfigReady)(cfg)
            ? (0, history_1.mergeDailyAstroTimes)(await (0, history_1.fetchAstroTimeHistory)(host, cfg.nightStartStateId, cfg.lookbackDays), await (0, history_1.fetchAstroTimeHistory)(host, cfg.nightEndStateId, cfg.lookbackDays))
            : null;
        const sampleDays = (0, history_1.distinctSocSampleDays)(socHist.points);
        const result = (0, math_1.withPowerDiagnostics)((0, math_1.computeBatteryRuntimeLearning)({
            socPoints: socHist.points,
            socPointsForFullCharge: socRaw,
            secondsSinceFull,
            powerPoints: powerHist.points,
            pvPowerPoints,
            housePowerPoints,
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
        await writeResult(host, result, lastRun, {
            pvPoints: pvPowerPoints.length,
            housePoints: housePowerPoints.length,
            pvOrigin,
        });
        host.log.info(`Battery-Runtime-Learning: status=${result.status} method=${result.nightBridgeMethod} nights=${result.avgNightDischargePct ?? "n/a"}% kwh=${result.avgNightDischargeKwh ?? "n/a"} bridgeH=${result.avgNightBridgeHours ?? "n/a"} samples=${result.sampleDays} pvPts=${pvPowerPoints.length} housePts=${housePowerPoints.length} pvOrigin=${pvOrigin} pvSrc=${(0, config_1.sourceLabelFromStateId)(sources.pvAcPowerStateId)} houseSrc=${(0, config_1.sourceLabelFromStateId)(sources.consumptionStateId)}`);
        host.log.debug?.(`Battery-Runtime-Learning detail: full_src=${result.fullChargeSource ?? "—"} sec_since_full=${result.secondsSinceFullCharge ?? "—"} days_since_full=${result.daysSinceFull ?? "—"} soc=${(0, config_1.sourceLabelFromStateId)(sources.socStateId)} power=${(0, config_1.sourceLabelFromStateId)(sources.powerStateId)} invert=${result.powerInvertApplied === null ? "—" : result.powerInvertApplied ? "on" : "off"}${result.powerInvertAuto ? "(auto)" : ""}`);
        if (result.nightBridgeMethod !== "pv_house" &&
            (!sources.pvAcPowerStateId || !sources.consumptionStateId)) {
            host.log.warn(`Battery-Runtime-Learning: PV/Hauslast-Nachtbrücke nicht möglich — Mapping fehlt (pv=${sources.pvAcPowerStateId || "—"}; house=${sources.consumptionStateId || "—"}). Fallback=${result.nightBridgeMethod}.`);
        }
        else if (result.nightBridgeMethod !== "pv_house" && (pvPowerPoints.length < 24 || housePowerPoints.length < 24)) {
            host.log.warn(`Battery-Runtime-Learning: PV/Hauslast-Historie zu dünn für Nachtbrücke (pv=${pvPowerPoints.length}, house=${housePowerPoints.length}) — Fallback=${result.nightBridgeMethod}. Power-Rollup/History für bat_pv_ac / consumption prüfen.`);
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
