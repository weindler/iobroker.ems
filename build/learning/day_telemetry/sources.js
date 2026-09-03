"use strict";
/**
 * Datenquellen für Tages-Telemetrie — bestehende EMS-Mirror-/Runtime-States.
 * Keine neuen Mappings; fehlende Werte bleiben null.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeUnitCombinationKey = exports.immersionOnFromPowers = exports.readLiveTelemetrySample = exports.resolveActiveSharedPowerGroupId = exports.resolveTelemetryPriceCtPerKwh = void 0;
const ensure_states_1 = require("../../addons/battery/ensure_states");
const types_1 = require("../../addons/immersion_heater/runtime/types");
/** Live-PV (gepflegt vom Live-Cache) — nicht grid_balance.pv_power_w (ungeschrieben). */
const LIVE_PV_POWER_W = "live.battery.pv_ac_power_w";
const LIVE_PV_POWER_W_MIRROR = "live.pv.power_w";
const ensure_states_2 = require("../../addons/air_conditioning/runtime/ensure_states");
const constants_1 = require("../../addons/air_conditioning/constants");
const config_1 = require("../../addons/air_conditioning/config");
const config_2 = require("../weather/config");
const ensure_states_3 = require("../../addons/wallbox/ev_foundation/ensure_states");
const state_ids_1 = require("../../addons/measured_consumers/runtime/state_ids");
const state_util_1 = require("../../ems_light/state_util");
const mapping_1 = require("../house_load/mapping");
const config_3 = require("../../statistics/config");
const config_4 = require("../house_load/config");
const constants_2 = require("../price_learning/constants");
const grid_states_1 = require("../../operator/supply/grid_states");
const contribution_ids_1 = require("../../operator/contribution_ids");
const climate_unit_slots_1 = require("./climate_unit_slots");
async function readNum(host, id) {
    if (!id)
        return null;
    let st = await host.getStateAsync(id);
    if ((st == null || st.val == null) && host.getForeignStateAsync) {
        st = await host.getForeignStateAsync(id);
    }
    return (0, state_util_1.asNum)(st?.val);
}
async function readBool(host, id) {
    if (!id)
        return null;
    const st = await host.getStateAsync(id);
    return (0, state_util_1.asBool)(st?.val);
}
async function readStr(host, id) {
    if (!id)
        return null;
    const st = await host.getStateAsync(id);
    if (st?.val == null)
        return null;
    const s = String(st.val).trim();
    return s || null;
}
/**
 * Realer Tarifpreis für den aktuellen Zeitpunkt — unabhängig vom Unified Day Plan.
 *
 * Primär: Grid-Supply-Slots (produktive Tarif-/Tibber-Pipeline).
 * Fallback: live.price.now_ct_per_kwh, dann grid.current_price_ct_per_kwh.
 * Niemals planner.intent.daily_plan.plan_json.
 */
async function resolveTelemetryPriceCtPerKwh(host, nowMs) {
    const slotsRaw = await readStr(host, grid_states_1.GRID_SUPPLY_STATE_IDS.slotsJson);
    if (slotsRaw) {
        try {
            const slots = JSON.parse(slotsRaw);
            if (Array.isArray(slots)) {
                for (const s of slots) {
                    const a = s.startIso ? Date.parse(s.startIso) : NaN;
                    const b = s.endIso ? Date.parse(s.endIso) : NaN;
                    if (!Number.isFinite(a) || !Number.isFinite(b))
                        continue;
                    if (nowMs >= a && nowMs < b) {
                        const ct = s.priceCtPerKwh;
                        if (ct != null && Number.isFinite(ct))
                            return ct;
                    }
                }
            }
        }
        catch {
            /* slots_json ungültig → Fallbacks */
        }
    }
    const live = await readNum(host, constants_2.DEFAULT_PRICE_STATE_ID);
    if (live != null && Number.isFinite(live))
        return live;
    const gridNow = await readNum(host, grid_states_1.GRID_SUPPLY_STATE_IDS.currentPriceCtPerKwh);
    if (gridNow != null && Number.isFinite(gridNow))
        return gridNow;
    return null;
}
exports.resolveTelemetryPriceCtPerKwh = resolveTelemetryPriceCtPerKwh;
/**
 * Shared-Power-Gruppe aus Admin-Config der aktiven Units.
 * null wenn keine Unit aktiv, Gruppe unbekannt oder mehrere unterschiedliche Gruppen.
 * Niemals "default" erfinden.
 */
function resolveActiveSharedPowerGroupId(active, config, plannerGroupByConsumerId) {
    const groups = new Set();
    let anyActive = false;
    for (let i = 0; i < active.length; i++) {
        if (!active[i])
            continue;
        anyActive = true;
        const unitIndex = i + 1;
        const fromConfig = (0, config_1.acUnitConfigFromAdapter)(config, unitIndex).sharedPowerGroupId?.trim() || null;
        const consumerId = contribution_ids_1.CONTRIBUTION_IDS.AC_UNIT(unitIndex);
        const fromPlanner = plannerGroupByConsumerId?.get(consumerId)?.trim() || null;
        const g = fromConfig || fromPlanner || null;
        if (g)
            groups.add(g);
    }
    if (!anyActive)
        return { groupId: null, rejectReason: null };
    if (groups.size === 1)
        return { groupId: [...groups][0], rejectReason: null };
    if (groups.size > 1) {
        return { groupId: null, rejectReason: "shared_power_group_ambiguous" };
    }
    return { groupId: null, rejectReason: "shared_power_group_unknown" };
}
exports.resolveActiveSharedPowerGroupId = resolveActiveSharedPowerGroupId;
async function readLiveTelemetrySample(host, nowMs = Date.now()) {
    const hlCfg = (0, config_4.houseLoadConfigFromAdapter)(host.config);
    const houseSrc = await (0, mapping_1.resolveHouseLoadPowerStateId)(host, hlCfg.powerStateId);
    const statsCfg = (0, config_3.statisticsConfigFromAdapter)(host.config);
    const climateUnitActive = [];
    let climateMode = null;
    const climateUnits = [];
    for (let i = 1; i <= constants_1.AC_UNIT_COUNT; i++) {
        const ids = (0, ensure_states_2.acUnitRuntimeStates)(i);
        const unitCfg = (0, config_1.acUnitConfigFromAdapter)(host.config, i);
        const running = await readBool(host, ids.running);
        const active = running === true;
        climateUnitActive.push(active);
        const purposeRaw = await readStr(host, ids.modePurpose);
        if (active && !climateMode) {
            climateMode = purposeRaw;
        }
        const roomTempC = await readNum(host, ids.roomTempC);
        const roomHumidityPct = await readNum(host, ids.roomHumidityPct);
        const include = unitCfg.enabled || active || roomTempC != null;
        if (!include)
            continue;
        const modePurpose = active ? (0, climate_unit_slots_1.normalizeClimateModePurpose)(purposeRaw) : "off";
        const ownershipOwner = await readStr(host, ids.ownershipOwner);
        const overrideUntilIso = await readStr(host, ids.ownershipOverrideUntilIso);
        const overrideActive = (0, climate_unit_slots_1.climateOverrideActive)(ownershipOwner, overrideUntilIso, nowMs);
        const targetTempC = await readNum(host, ids.setpointTempC);
        const modesAvailable = (0, config_1.availableAcModePurposes)(unitCfg);
        climateUnits.push({
            unitIndex: i,
            enabled: unitCfg.enabled,
            roomTempC,
            roomHumidityPct,
            targetTempC,
            coolingOnTempC: Number.isFinite(unitCfg.onTempC) ? unitCfg.onTempC : null,
            coolingOffTempC: Number.isFinite(unitCfg.offTempC) ? unitCfg.offTempC : null,
            heatingSetpointC: unitCfg.heatSetpointC,
            maxHumidityPct: unitCfg.maxHumidityPct,
            modesAvailable,
            running,
            modePurpose,
            hardOffAt: unitCfg.hardOffAt?.trim() || null,
            demandUrgency01: (0, climate_unit_slots_1.climateSlotDemandUrgency01)({
                modePurpose,
                roomTempC,
                coolingOnTempC: unitCfg.onTempC,
                roomHumidityPct,
                maxHumidityPct: unitCfg.maxHumidityPct,
            }),
            ownershipOwner,
            overrideActive,
            sharedPowerGroupId: unitCfg.sharedPowerGroupId,
        });
    }
    const sharedResolved = resolveActiveSharedPowerGroupId(climateUnitActive, host.config, null);
    const weatherCfg = (0, config_2.weatherConfigFromAdapter)(host.config);
    const tempMetric = weatherCfg.metrics.temp;
    const cloudMetric = weatherCfg.metrics.cloud;
    const outdoorTempC = tempMetric ? await readNum(host, tempMetric.actualStateId) : null;
    const cloudPct = cloudMetric ? await readNum(host, cloudMetric.actualStateId) : null;
    const batPower = await readNum(host, ensure_states_1.BAT.telemetry.powerW);
    const batCharge = await readNum(host, ensure_states_1.BAT.telemetry.chargingPowerW);
    const batDischarge = await readNum(host, ensure_states_1.BAT.telemetry.dischargingPowerW);
    let chargeW = batCharge;
    let dischargeW = batDischarge;
    if (chargeW == null && dischargeW == null && batPower != null) {
        if (batPower > 0)
            chargeW = batPower;
        else if (batPower < 0)
            dischargeW = Math.abs(batPower);
    }
    const sharedUsed = await readBool(host, ensure_states_2.AC_RUNTIME_SUMMARY_STATES.systemSharedPowerUsed);
    const systemPower = await readNum(host, ensure_states_2.AC_RUNTIME_SUMMARY_STATES.systemPowerW);
    const pvLive = (await readNum(host, LIVE_PV_POWER_W)) ?? (await readNum(host, LIVE_PV_POWER_W_MIRROR));
    return {
        tsMs: nowMs,
        pvPowerW: pvLive,
        houseTotalPowerW: houseSrc.stateId ? await readNum(host, houseSrc.stateId) : null,
        immersionPowerW: await readNum(host, types_1.IMMERSION_RUNTIME_STATES.measuredPowerW),
        wallboxChargePowerW: await readNum(host, ensure_states_3.WALLBOX_EV_FOUNDATION_STATES.chargePowerW),
        batteryChargePowerW: chargeW,
        batteryDischargePowerW: dischargeW,
        gridBalanceDischargePowerW: await readNum(host, ensure_states_1.BAT.gridBalance.effectivePowerW),
        gridBalanceRequestedPowerW: await readNum(host, ensure_states_1.BAT.gridBalance.requestedPowerW),
        gridBalanceActive: await readBool(host, ensure_states_1.BAT.gridBalance.active),
        batterySetpointOwner: await readStr(host, ensure_states_1.BAT.runtime.batterySetpointOwner),
        climateSystemPowerW: systemPower,
        climateSharedPowerUsed: sharedUsed,
        climateUnitActive,
        climateMode,
        climateSharedPowerGroupId: sharedResolved.groupId,
        gridImportEnergyKwh: statsCfg.gridImportEnergyKwhStateId
            ? await readNum(host, statsCfg.gridImportEnergyKwhStateId)
            : null,
        gridExportEnergyKwh: statsCfg.gridExportEnergyKwhStateId
            ? await readNum(host, statsCfg.gridExportEnergyKwhStateId)
            : null,
        gridImportPowerW: statsCfg.gridImportPowerWStateId
            ? await readNum(host, statsCfg.gridImportPowerWStateId)
            : null,
        priceCtPerKwh: await resolveTelemetryPriceCtPerKwh(host, nowMs),
        batterySocPct: await readNum(host, ensure_states_1.BAT.telemetry.socPct),
        evChargePowerW: await readNum(host, ensure_states_3.WALLBOX_EV_FOUNDATION_STATES.chargePowerW),
        evSocPct: await readNum(host, ensure_states_3.WALLBOX_EV_FOUNDATION_STATES.vehicleSocPct),
        evConnected: await readBool(host, ensure_states_3.WALLBOX_EV_FOUNDATION_STATES.vehicleConnected),
        immersionRuntimeOn: null,
        boilerTempC: (await readNum(host, types_1.IMMERSION_RUNTIME_STATES.boilerTemperatureC)) ??
            (await readNum(host, types_1.IMMERSION_RUNTIME_STATES.bufferTemperatureC)),
        otherMeasuredConsumersPowerW: await readNum(host, state_ids_1.MEASURED_CONSUMERS_AGGREGATE_STATES.totalPowerW),
        ownershipActive: null,
        immersionDecisionSource: await readStr(host, types_1.IMMERSION_RUNTIME_STATES.decisionSource),
        immersionResolvedMode: await readStr(host, types_1.IMMERSION_RUNTIME_STATES.resolvedMode),
        immersionHygieneStatusDe: await readStr(host, types_1.IMMERSION_RUNTIME_STATES.hygieneStatusDe),
        immersionOwnershipOwner: await readStr(host, types_1.IMMERSION_RUNTIME_STATES.ownershipOwner),
        outdoorTempC,
        cloudPct,
        climateUnits,
    };
}
exports.readLiveTelemetrySample = readLiveTelemetrySample;
/** Nach Sample: Immersion-on aus Leistung ableiten. */
function immersionOnFromPowers(measuredW, commandedW) {
    if (measuredW != null && Number.isFinite(measuredW))
        return measuredW > 50;
    if (commandedW != null && Number.isFinite(commandedW))
        return commandedW > 50;
    return null;
}
exports.immersionOnFromPowers = immersionOnFromPowers;
/** Aktive Unit-Kombination als kompakter String (z. B. "1+3" oder "none"). */
function activeUnitCombinationKey(active) {
    const ids = [];
    for (let i = 0; i < active.length; i++) {
        if (active[i])
            ids.push(i + 1);
    }
    return ids.length ? ids.join("+") : "none";
}
exports.activeUnitCombinationKey = activeUnitCombinationKey;
