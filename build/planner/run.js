"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPlanner = exports.resetPlannerRevisionForTest = void 0;
const battery_1 = require("../operator/planning/battery");
const battery_winter_1 = require("../operator/planning/battery_winter");
const surplus_1 = require("../operator/planning/surplus");
const thermal_1 = require("../operator/planning/thermal");
const cooling_1 = require("../operator/planning/cooling");
const battery_consumers_1 = require("../policy/battery_consumers");
let revision = 0;
function resetPlannerRevisionForTest() {
    revision = 0;
}
exports.resetPlannerRevisionForTest = resetPlannerRevisionForTest;
function runPlanner(inputs) {
    const surplusW = (0, surplus_1.computePvSurplusW)(inputs.pvPowerW, inputs.houseLoadW);
    const deficitW = (0, battery_1.computeDeficitW)(inputs.pvPowerW, inputs.houseLoadW);
    const constraintsHold = (0, battery_1.buildPlannerConstraints)({
        evccBatteryMode: inputs.evccBatteryMode,
        evccBatteryDischargeControl: inputs.evccBatteryDischargeControl,
        userIntentBatteryHold: inputs.userIntentBatteryHold,
        wallboxChargeHold: inputs.wallboxChargeHold === true,
        wallboxChargeHoldReasonDe: inputs.wallboxChargeHoldReasonDe ?? null,
    });
    const batConsumers = (0, battery_consumers_1.batteryConsumersConfigFromAdapter)(inputs.adapterConfig ?? {});
    const immersionCritical = (0, battery_consumers_1.immersionCriticalNow)(inputs.bufferTempC, inputs.immersionConfig.planningMinTempC, batConsumers.immersion_heater.criticalMarginK);
    const consumerAccess = (0, battery_consumers_1.resolveAllBatteryConsumerAccess)({
        config: batConsumers,
        batteryHoldActive: constraintsHold.battery_hold_active,
        socPct: inputs.socPct,
        criticalByConsumer: {
            immersion_heater: immersionCritical,
            air_conditioning: null,
            wallbox: false,
        },
    });
    const constraints = {
        ...constraintsHold,
        battery_consumer_immersion_allowed: consumerAccess.immersion_heater.allowed,
        battery_consumer_immersion_reason_de: consumerAccess.immersion_heater.reasonDe,
        battery_consumer_climate_allowed: consumerAccess.air_conditioning.allowed,
        battery_consumer_climate_reason_de: consumerAccess.air_conditioning.reasonDe,
        battery_consumer_wallbox_allowed: consumerAccess.wallbox.allowed,
        battery_consumer_wallbox_reason_de: consumerAccess.wallbox.reasonDe,
    };
    const thermal = (0, thermal_1.planThermal)({
        surplusW,
        bufferTempC: inputs.bufferTempC,
        thermalMode: inputs.thermalMode,
        governanceEnabled: inputs.thermalGovernanceEnabled,
        config: inputs.immersionConfig,
        modePolicy: inputs.modePolicy,
        pvTodayKwh: inputs.pvTodayKwh,
        pvTomorrowKwh: inputs.pvTomorrowKwh,
        pvBiasStatus: inputs.pvBiasStatus,
        forecastModeEnabled: inputs.forecastModeEnabled,
        aiOptimizationAllowed: inputs.aiOptimizationAllowed,
    });
    const thermalAllocatedW = thermal.commanded_stage > 0 ? thermal.commanded_power_w : 0;
    const coolingFull = (0, cooling_1.planCooling)({
        now: inputs.now,
        acConfig: inputs.acConfig,
        governanceEnabled: inputs.coolingGovernanceEnabled,
        outdoorTempC: inputs.outdoorTempC,
        units: inputs.coolingUnits,
    });
    const cooling = {
        expected_kwh_today: coolingFull.expected_kwh_today,
        expected_peak_w: coolingFull.expected_peak_w,
        likely_active: coolingFull.likely_active,
        reason_de: coolingFull.reason_de,
        forecast_active: coolingFull.forecast_active,
    };
    const consumerAllocatedW = thermalAllocatedW + (0, cooling_1.coolingReserveW)(cooling);
    const battery = (0, battery_1.planBattery)({
        surplusW,
        deficitW,
        socPct: inputs.socPct,
        governanceEnabled: inputs.batteryGovernanceEnabled,
        constraints,
        consumerAllocatedW,
        modePolicy: inputs.modePolicy,
    });
    const batteryWinterRaw = (0, battery_winter_1.planBatteryWinter)({
        now: inputs.now,
        socPct: inputs.socPct,
        snowCoverSuspected: inputs.snowCoverSuspected,
        config: inputs.batteryWinterConfig,
        modePolicy: inputs.modePolicy,
        batteryGovernanceEnabled: inputs.batteryGovernanceEnabled,
        batteryAiAllowed: inputs.batteryAiAllowed,
        days: inputs.batteryWinterDays,
        priceSlots: inputs.batteryWinterPriceSlots,
    });
    const battery_winter = {
        active: batteryWinterRaw.active,
        forecast_active: batteryWinterRaw.forecast_active,
        horizon_days: batteryWinterRaw.horizon_days,
        bridge_until_iso: batteryWinterRaw.bridge_until_iso,
        pv_recovery_day: batteryWinterRaw.pv_recovery_day,
        energy_stored_kwh: batteryWinterRaw.energy_stored_kwh,
        energy_deficit_kwh: batteryWinterRaw.energy_deficit_kwh,
        energy_reserve_kwh: batteryWinterRaw.energy_reserve_kwh,
        energy_target_kwh: batteryWinterRaw.energy_target_kwh,
        soc_target_pct: batteryWinterRaw.soc_target_pct,
        charge_energy_kwh: batteryWinterRaw.charge_energy_kwh,
        charge_duration_h: batteryWinterRaw.charge_duration_h,
        charge_slots_15m: batteryWinterRaw.charge_slots_15m,
        confidence_min_pct: batteryWinterRaw.confidence_min_pct,
        windows_json: JSON.stringify(batteryWinterRaw.windows),
        reason_de: batteryWinterRaw.reason_de,
    };
    revision += 1;
    const reasonParts = [
        `Global Mode ${inputs.globalMode}`,
        inputs.modePolicy.labelDe,
    ];
    if (surplusW !== null && surplusW > 0) {
        reasonParts.push(`PV-Überschuss ${surplusW} W`);
    }
    if (deficitW !== null && deficitW > 0) {
        reasonParts.push(`PV-Unterdeckung ${deficitW} W`);
    }
    if (thermal.commanded_stage > 0) {
        reasonParts.push(`Heizstab Stufe ${thermal.commanded_stage}`);
    }
    else if (thermal.forecast_active && inputs.bufferTempC !== null && inputs.bufferTempC >= thermal.target_temp_c) {
        reasonParts.push(`Heizstab Tagesziel ${thermal.target_temp_c} °C erreicht`);
    }
    if (cooling.likely_active) {
        reasonParts.push(`Klima ~${cooling.expected_kwh_today} kWh (Peak ${cooling.expected_peak_w} W)`);
    }
    if (battery.action === "charge") {
        reasonParts.push(`Batterie +${battery.max_charge_w} W`);
    }
    else if (battery.action === "self_consumption") {
        reasonParts.push("Batterie Eigenverbrauch");
    }
    else if (battery.action === "hold") {
        reasonParts.push("Batterie Hold");
    }
    if (constraints.battery_hold_active) {
        reasonParts.push("Hold-Sperre aktiv");
    }
    if (batteryWinterRaw.forecast_active) {
        reasonParts.push(`Winter-Netz: ${batteryWinterRaw.soc_target_pct ?? "—"} % Ziel`);
    }
    return {
        schema_version: 1,
        revision,
        resolved_at: inputs.now.toISOString(),
        reason_de: reasonParts.join(". ") + ".",
        global_mode: {
            active: inputs.globalMode,
            policy_label_de: inputs.modePolicy.labelDe,
        },
        surplus_w: surplusW,
        deficit_w: deficitW,
        pv_power_w: inputs.pvPowerW,
        house_load_w: inputs.houseLoadW,
        constraints,
        thermal,
        cooling,
        battery,
        battery_winter,
    };
}
exports.runPlanner = runPlanner;
