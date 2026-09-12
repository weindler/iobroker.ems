"use strict";
/**
 * Lokale, read-only Projektion für eine spätere EMS-Light-App.
 *
 * Der Snapshot besitzt keinerlei Steuerpfad. Er fasst ausschließlich bereits publizierte
 * Core-, Planner-, Geräte-, Learning- und Statistikzustände zusammen. Fehlende Werte bleiben
 * `null`; ungültige JSON-Quellen werden als Qualitätsbefund ausgewiesen.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishAppCoreSnapshot = exports.collectAppCoreSnapshot = exports.buildAppCoreSnapshot = exports.appCoreSnapshotStateIds = exports.APP_CORE_CONTRACT = exports.APP_CORE_SNAPSHOT_STATE = exports.APP_CORE_CONTRACT_STATE = void 0;
const charge_hold_1 = require("../addons/wallbox/charge_hold");
exports.APP_CORE_CONTRACT_STATE = "app.core_contract_json";
exports.APP_CORE_SNAPSHOT_STATE = "app.core_snapshot_json";
exports.APP_CORE_CONTRACT = {
    schemaVersion: 1,
    snapshotStateId: exports.APP_CORE_SNAPSHOT_STATE,
    profileCatalogStateId: "profiles.catalog_json",
    plannerOutlookStateId: "operator.outlook_72h.json",
    controlPath: "unified_daily_plan",
    readOnly: true,
    localControlIndependentOfCloud: true,
};
const BASE_STATE_IDS = [
    "system.version",
    "system.health",
    "system.last_tick_at",
    "global.execution_mode",
    "planner.intent.daily_plan.status",
    "planner.intent.daily_plan.valid_until",
    "planner.intent.daily_plan.reason_de",
    "operator.outlook_72h.json",
    "profiles.catalog_json",
    "addons.battery.identity.controller_profile",
    "live.battery.soc_pct",
    "addons.battery.telemetry.power_w",
    "addons.battery.telemetry.charging_power_w",
    "addons.battery.telemetry.operating_mode",
    "addons.battery.telemetry.stale",
    "addons.battery.runtime.action",
    "addons.battery.runtime.target_soc_pct",
    "addons.battery.runtime.battery_setpoint_owner",
    "addons.battery.runtime.reason_de",
    "addons.battery.status.fault",
    "addons.battery.status.lockout",
    "learning.battery_runtime.predicted_night_consumption_kwh",
    "learning.battery_runtime.required_night_reserve_kwh",
    "learning.battery_runtime.sample_days",
    "learning.battery_runtime.night_estimator",
    "learning.battery_runtime.night_reserve_reason_de",
    "addons.immersion_heater.runtime.boiler_temperature_c",
    "addons.immersion_heater.runtime.buffer_temperature_c",
    "addons.immersion_heater.runtime.measured_power_w",
    "addons.immersion_heater.runtime.state",
    "addons.immersion_heater.runtime.hygiene_status_de",
    "addons.immersion_heater.runtime.reason",
    "addons.immersion_heater.runtime.reason_de",
    "learning.thermal_boiler.estimated_remaining_hours",
    "learning.thermal_boiler.estimated_empty_at",
    "learning.thermal_boiler.quality",
    "learning.thermal_boiler.samples",
    "learning.thermal_runtime.estimated_remaining_hours",
    "learning.thermal_runtime.estimated_empty_at",
    "learning.thermal_runtime.quality",
    "learning.thermal_runtime.samples",
    "addons.wallbox.status.evcc.connected",
    "addons.wallbox.status.evcc.charging",
    "addons.wallbox.status.evcc.vehicle_soc_pct",
    "addons.wallbox.status.evcc.effective_limit_soc_pct",
    "addons.wallbox.status.evcc.charge_power_w",
    "addons.wallbox.status.evcc.charge_remaining_energy_kwh",
    "addons.wallbox.status.evcc.loadpoint_mode",
    "addons.wallbox.runtime.reason_de",
    "addons.wallbox.runtime.battery_hold_for_ev_charge",
    "addons.wallbox.runtime.tibber_grid_rewards_active",
    "addons.wallbox.runtime.external_vehicle_charge_active",
    "addons.battery.grid_balance.enabled",
    "addons.battery.grid_balance.active",
    "addons.battery.grid_balance.ready",
    "addons.battery.grid_balance.block_reason",
    "addons.battery.grid_balance.explain",
    "addons.battery.grid_balance.grid_power_w",
    "addons.battery.grid_balance.requested_discharge_w",
    "addons.battery.grid_balance.effective_discharge_w",
    "learning.grid_balance_economics.usable",
    "learning.grid_balance_economics.alpha",
    "learning.grid_balance_economics.beta",
    "learning.grid_balance_economics.confidence",
    "learning.grid_balance_economics.pair_count",
    "learning.grid_balance_economics.reason_de",
    "statistics.period_id",
    "statistics.energy.today_json",
    "statistics.energy.period_json",
    "economics.today.tarifvorteil_eur",
    "economics.today.ems_vorteil_eur",
    "economics.today.ki_mehrwert_eur",
    "economics.today.grid_rewards_eur",
    "economics.period.tarifvorteil_eur",
    "economics.period.ems_vorteil_eur",
    "economics.period.ki_mehrwert_eur",
    "economics.period.grid_rewards_eur",
    "economics.period.label_de",
];
const CLIMATE_FIELDS = [
    "name",
    "running",
    "room_temp_c",
    "room_humidity_pct",
    "setpoint_temp_c",
    "mode_purpose",
    "measured_power_w",
    "estimated_power_w",
    "hard_off_remaining_min",
    "reason_de",
    "allocation_reason_de",
];
const CLIMATE_LEARNING_FIELDS = [
    "passive_temp_rate_k_per_h",
    "passive_confidence",
    "cooling_temp_rate_k_per_h",
    "cooling_confidence",
    "heating_temp_rate_k_per_h",
    "heating_confidence",
    "dehumidify_humidity_rate_pct_per_h",
    "dehumidify_confidence",
    "reason_de",
];
function appCoreSnapshotStateIds() {
    const ids = [...BASE_STATE_IDS];
    for (let unit = 1; unit <= 5; unit++) {
        for (const field of CLIMATE_FIELDS)
            ids.push(`addons.air_conditioning.units.unit_${unit}.${field}`);
        for (const field of CLIMATE_LEARNING_FIELDS)
            ids.push(`learning.climate_thermal.unit_${unit}.${field}`);
    }
    return ids;
}
exports.appCoreSnapshotStateIds = appCoreSnapshotStateIds;
function textValue(value) {
    if (value === null || value === undefined || value === "")
        return null;
    return String(value);
}
function numberValue(value) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean")
        return null;
    const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    return Number.isFinite(number) ? number : null;
}
function booleanValue(value) {
    if (typeof value === "boolean")
        return value;
    if (value === 1 || value === "1" || value === "true")
        return true;
    if (value === 0 || value === "0" || value === "false")
        return false;
    return null;
}
function objectValue(value, id, invalidJsonStateIds) {
    if (value === null || value === undefined || value === "")
        return null;
    try {
        const parsed = typeof value === "string" ? JSON.parse(value) : value;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            invalidJsonStateIds.push(id);
            return null;
        }
        return parsed;
    }
    catch {
        invalidJsonStateIds.push(id);
        return null;
    }
}
function decisionFor(outlook, kind, consumerId) {
    const decisions = Array.isArray(outlook?.decisions) ? outlook.decisions : [];
    for (const raw of decisions) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
            continue;
        const decision = raw;
        if (decision.kind !== kind)
            continue;
        if (consumerId && decision.consumerId !== consumerId)
            continue;
        return decision;
    }
    return null;
}
function configText(config, key) {
    if (!config || typeof config !== "object")
        return null;
    return textValue(config[key]);
}
function climateDevices(values, config, outlook) {
    const devices = [];
    for (let unit = 1; unit <= 5; unit++) {
        const base = `addons.air_conditioning.units.unit_${unit}`;
        const name = textValue(values[`${base}.name`]);
        if (!name || name === "—")
            continue;
        const learning = `learning.climate_thermal.unit_${unit}`;
        devices.push({
            id: `air_conditioning.unit_${unit}`,
            deviceClass: "climate",
            labelDe: name,
            templateId: configText(config, `ac_u${unit}_profile`) ?? configText(config, "ac_default_profile"),
            current: {
                running: booleanValue(values[`${base}.running`]),
                roomTempC: numberValue(values[`${base}.room_temp_c`]),
                roomHumidityPct: numberValue(values[`${base}.room_humidity_pct`]),
                setpointTempC: numberValue(values[`${base}.setpoint_temp_c`]),
                modePurpose: textValue(values[`${base}.mode_purpose`]),
                measuredPowerW: numberValue(values[`${base}.measured_power_w`]),
                estimatedPowerW: numberValue(values[`${base}.estimated_power_w`]),
                hardOffRemainingMin: numberValue(values[`${base}.hard_off_remaining_min`]),
            },
            learned: {
                passiveTempRateKPerH: numberValue(values[`${learning}.passive_temp_rate_k_per_h`]),
                passiveConfidence: numberValue(values[`${learning}.passive_confidence`]),
                coolingTempRateKPerH: numberValue(values[`${learning}.cooling_temp_rate_k_per_h`]),
                coolingConfidence: numberValue(values[`${learning}.cooling_confidence`]),
                heatingTempRateKPerH: numberValue(values[`${learning}.heating_temp_rate_k_per_h`]),
                heatingConfidence: numberValue(values[`${learning}.heating_confidence`]),
                dehumidifyHumidityRatePctPerH: numberValue(values[`${learning}.dehumidify_humidity_rate_pct_per_h`]),
                dehumidifyConfidence: numberValue(values[`${learning}.dehumidify_confidence`]),
                reasonDe: textValue(values[`${learning}.reason_de`]),
            },
            next: decisionFor(outlook, "climate", `air_conditioning.unit_${unit}`),
            reasonDe: textValue(values[`${base}.allocation_reason_de`]) ?? textValue(values[`${base}.reason_de`]),
        });
    }
    return devices;
}
function buildAppCoreSnapshot(args) {
    const { values } = args;
    const invalidJsonStateIds = [];
    const outlook = objectValue(values["operator.outlook_72h.json"], "operator.outlook_72h.json", invalidJsonStateIds);
    const catalog = objectValue(values["profiles.catalog_json"], "profiles.catalog_json", invalidJsonStateIds);
    const energyToday = objectValue(values["statistics.energy.today_json"], "statistics.energy.today_json", invalidJsonStateIds);
    const energyPeriod = objectValue(values["statistics.energy.period_json"], "statistics.energy.period_json", invalidJsonStateIds);
    const batteryChargingPowerW = numberValue(values["addons.battery.telemetry.charging_power_w"]);
    const batteryOperatingMode = textValue(values["addons.battery.telemetry.operating_mode"]);
    const batteryGridChargeActive = (() => {
        const owner = textValue(values["addons.battery.runtime.battery_setpoint_owner"]);
        const action = textValue(values["addons.battery.runtime.action"]);
        if (owner === "grid_charge" || action === "grid_charge" || batteryOperatingMode === "grid_charging") {
            return true;
        }
        if (batteryOperatingMode === "manual" &&
            batteryChargingPowerW !== null &&
            batteryChargingPowerW > 50) {
            return true;
        }
        if (owner === null && action === null && batteryOperatingMode === null && batteryChargingPowerW === null) {
            return null;
        }
        return false;
    })();
    const evccMode = textValue(values["addons.wallbox.status.evcc.loadpoint_mode"]);
    const evConnected = booleanValue(values["addons.wallbox.status.evcc.connected"]);
    const evCharging = booleanValue(values["addons.wallbox.status.evcc.charging"]);
    const evChargePowerW = numberValue(values["addons.wallbox.status.evcc.charge_power_w"]);
    const evActuallyCharging = (() => {
        if ((0, charge_hold_1.isEvActuallyCharging)({ charging: evCharging, chargePowerW: evChargePowerW }))
            return true;
        if (evCharging === false || evChargePowerW !== null)
            return false;
        return null;
    })();
    const evccNowActive = (() => {
        if (evConnected === false)
            return false;
        if (evccMode !== null && evccMode.toLowerCase() !== "now")
            return false;
        if (evConnected === null || evccMode === null || evActuallyCharging === null)
            return null;
        return evActuallyCharging;
    })();
    const externalFastChargeActive = (() => {
        const batteryHold = booleanValue(values["addons.wallbox.runtime.battery_hold_for_ev_charge"]);
        if (batteryHold !== null)
            return batteryHold;
        if (evConnected === false)
            return false;
        const external = booleanValue(values["addons.wallbox.runtime.external_vehicle_charge_active"]);
        const rewards = booleanValue(values["addons.wallbox.runtime.tibber_grid_rewards_active"]);
        if (external === null && rewards === null && evccNowActive === null)
            return null;
        return external === true || rewards === true || evccNowActive === true;
    })();
    const gridBalanceActive = booleanValue(values["addons.battery.grid_balance.active"]);
    const gridBalanceMustBeOff = batteryGridChargeActive === null && evccNowActive === null && externalFastChargeActive === null
        ? null
        : batteryGridChargeActive === true || evccNowActive === true || externalFastChargeActive === true;
    const gridBalanceInvariantSatisfied = gridBalanceMustBeOff !== true
        ? null
        : gridBalanceActive === null
            ? null
            : gridBalanceActive === false;
    const devices = [
        {
            id: "battery",
            deviceClass: "battery",
            labelDe: "Batterie",
            templateId: textValue(values["addons.battery.identity.controller_profile"]),
            current: {
                socPct: numberValue(values["live.battery.soc_pct"]),
                powerW: numberValue(values["addons.battery.telemetry.power_w"]),
                chargingPowerW: batteryChargingPowerW,
                operatingMode: batteryOperatingMode,
                telemetryStale: booleanValue(values["addons.battery.telemetry.stale"]),
                action: textValue(values["addons.battery.runtime.action"]),
                targetSocPct: numberValue(values["addons.battery.runtime.target_soc_pct"]),
                setpointOwner: textValue(values["addons.battery.runtime.battery_setpoint_owner"]),
                fault: booleanValue(values["addons.battery.status.fault"]),
                lockout: booleanValue(values["addons.battery.status.lockout"]),
            },
            learned: {
                predictedNightConsumptionKwh: numberValue(values["learning.battery_runtime.predicted_night_consumption_kwh"]),
                requiredNightReserveKwh: numberValue(values["learning.battery_runtime.required_night_reserve_kwh"]),
                sampleDays: numberValue(values["learning.battery_runtime.sample_days"]),
                estimator: textValue(values["learning.battery_runtime.night_estimator"]),
                reasonDe: textValue(values["learning.battery_runtime.night_reserve_reason_de"]),
            },
            next: decisionFor(outlook, "battery_charge"),
            reasonDe: textValue(values["addons.battery.runtime.reason_de"]),
        },
        {
            id: "immersion_heater",
            deviceClass: "immersion_heater",
            labelDe: "Heizstab / Wärme",
            templateId: "generic_mapping",
            current: {
                boilerTempC: numberValue(values["addons.immersion_heater.runtime.boiler_temperature_c"]),
                bufferTempC: numberValue(values["addons.immersion_heater.runtime.buffer_temperature_c"]),
                powerW: numberValue(values["addons.immersion_heater.runtime.measured_power_w"]),
                state: textValue(values["addons.immersion_heater.runtime.state"]),
                hygieneStatusDe: textValue(values["addons.immersion_heater.runtime.hygiene_status_de"]),
            },
            learned: {
                boilerRemainingHours: numberValue(values["learning.thermal_boiler.estimated_remaining_hours"]),
                boilerEmptyAtIso: textValue(values["learning.thermal_boiler.estimated_empty_at"]),
                boilerQuality: textValue(values["learning.thermal_boiler.quality"]),
                boilerSamples: numberValue(values["learning.thermal_boiler.samples"]),
                bufferRemainingHours: numberValue(values["learning.thermal_runtime.estimated_remaining_hours"]),
                bufferEmptyAtIso: textValue(values["learning.thermal_runtime.estimated_empty_at"]),
                bufferQuality: textValue(values["learning.thermal_runtime.quality"]),
                bufferSamples: numberValue(values["learning.thermal_runtime.samples"]),
            },
            next: decisionFor(outlook, "immersion_heater"),
            reasonDe: textValue(values["addons.immersion_heater.runtime.reason_de"]) ??
                textValue(values["addons.immersion_heater.runtime.reason"]),
        },
        {
            id: "wallbox",
            deviceClass: "wallbox",
            labelDe: "Auto / Wallbox",
            templateId: "evcc_generic",
            current: {
                connected: booleanValue(values["addons.wallbox.status.evcc.connected"]),
                charging: booleanValue(values["addons.wallbox.status.evcc.charging"]),
                vehicleSocPct: numberValue(values["addons.wallbox.status.evcc.vehicle_soc_pct"]),
                targetSocPct: numberValue(values["addons.wallbox.status.evcc.effective_limit_soc_pct"]),
                chargePowerW: numberValue(values["addons.wallbox.status.evcc.charge_power_w"]),
                remainingEnergyKwh: numberValue(values["addons.wallbox.status.evcc.charge_remaining_energy_kwh"]),
                loadpointMode: evccMode,
                gridRewardsActive: booleanValue(values["addons.wallbox.runtime.tibber_grid_rewards_active"]),
            },
            learned: {
                energyToday,
                energyPeriod,
            },
            next: decisionFor(outlook, "wallbox"),
            reasonDe: textValue(values["addons.wallbox.runtime.reason_de"]),
        },
        {
            id: "grid_balance",
            deviceClass: "grid_balance",
            labelDe: "Grid Balance",
            templateId: textValue(values["addons.battery.identity.controller_profile"]),
            current: {
                enabled: booleanValue(values["addons.battery.grid_balance.enabled"]),
                active: gridBalanceActive,
                ready: booleanValue(values["addons.battery.grid_balance.ready"]),
                gridPowerW: numberValue(values["addons.battery.grid_balance.grid_power_w"]),
                requestedDischargeW: numberValue(values["addons.battery.grid_balance.requested_discharge_w"]),
                effectiveDischargeW: numberValue(values["addons.battery.grid_balance.effective_discharge_w"]),
                blockReason: textValue(values["addons.battery.grid_balance.block_reason"]),
            },
            learned: {
                usable: booleanValue(values["learning.grid_balance_economics.usable"]),
                alpha: numberValue(values["learning.grid_balance_economics.alpha"]),
                beta: numberValue(values["learning.grid_balance_economics.beta"]),
                confidence: numberValue(values["learning.grid_balance_economics.confidence"]),
                pairCount: numberValue(values["learning.grid_balance_economics.pair_count"]),
                reasonDe: textValue(values["learning.grid_balance_economics.reason_de"]),
            },
            next: {
                kind: "reactive_grid_balance",
                mustBeOff: gridBalanceMustBeOff,
                ready: booleanValue(values["addons.battery.grid_balance.ready"]),
            },
            reasonDe: textValue(values["addons.battery.grid_balance.explain"]) ??
                textValue(values["addons.battery.grid_balance.block_reason"]),
        },
        ...climateDevices(values, args.config, outlook),
    ];
    return {
        schemaVersion: 1,
        generatedAtIso: args.generatedAtIso,
        source: "local_iobroker",
        localControlIndependentOfCloud: true,
        controlPath: "unified_daily_plan",
        system: {
            version: textValue(values["system.version"]),
            health: args.health ?? textValue(values["system.health"]),
            executionMode: args.executionMode ?? textValue(values["global.execution_mode"]),
            lastTickAtIso: args.generatedAtIso ?? textValue(values["system.last_tick_at"]),
        },
        planner: {
            status: textValue(values["planner.intent.daily_plan.status"]),
            validUntilIso: textValue(values["planner.intent.daily_plan.valid_until"]),
            reasonDe: textValue(values["planner.intent.daily_plan.reason_de"]),
            outlook72h: outlook,
        },
        profiles: {
            catalogStateId: "profiles.catalog_json",
            catalog,
        },
        devices,
        learning: {
            batteryNight: devices.find((device) => device.id === "battery")?.learned ?? {},
            thermal: devices.find((device) => device.id === "immersion_heater")?.learned ?? {},
            gridBalanceEconomics: devices.find((device) => device.id === "grid_balance")?.learned ?? {},
        },
        statistics: {
            periodId: textValue(values["statistics.period_id"]),
            energyToday,
            energyPeriod,
            economics: {
                today: {
                    tariffAdvantageEur: numberValue(values["economics.today.tarifvorteil_eur"]),
                    emsValueEur: numberValue(values["economics.today.ems_vorteil_eur"]),
                    aiValueEur: numberValue(values["economics.today.ki_mehrwert_eur"]),
                    gridRewardsEur: numberValue(values["economics.today.grid_rewards_eur"]),
                },
                period: {
                    labelDe: textValue(values["economics.period.label_de"]),
                    tariffAdvantageEur: numberValue(values["economics.period.tarifvorteil_eur"]),
                    emsValueEur: numberValue(values["economics.period.ems_vorteil_eur"]),
                    aiValueEur: numberValue(values["economics.period.ki_mehrwert_eur"]),
                    gridRewardsEur: numberValue(values["economics.period.grid_rewards_eur"]),
                },
            },
        },
        safety: {
            batteryGridChargeActive,
            evccNowActive,
            externalFastChargeActive,
            gridBalanceActive,
            gridBalanceMustBeOff,
            gridBalanceInvariantSatisfied,
        },
        dataQuality: {
            missingStateIds: [...new Set(args.missingStateIds ?? [])].sort(),
            invalidJsonStateIds: [...new Set(invalidJsonStateIds)].sort(),
            tickHints: [...(args.tickHints ?? [])],
        },
    };
}
exports.buildAppCoreSnapshot = buildAppCoreSnapshot;
async function collectAppCoreSnapshot(host, args) {
    const values = {};
    const missingStateIds = [];
    await Promise.all(appCoreSnapshotStateIds().map(async (id) => {
        try {
            const state = await host.getStateAsync(id);
            if (!state)
                missingStateIds.push(id);
            values[id] = state?.val ?? null;
        }
        catch {
            missingStateIds.push(id);
            values[id] = null;
        }
    }));
    return buildAppCoreSnapshot({
        ...args,
        values,
        missingStateIds,
        config: host.config,
    });
}
exports.collectAppCoreSnapshot = collectAppCoreSnapshot;
async function publishAppCoreSnapshot(host, args) {
    const snapshot = await collectAppCoreSnapshot(host, args);
    await host.setStateAsync(exports.APP_CORE_SNAPSHOT_STATE, {
        val: JSON.stringify(snapshot),
        ack: true,
    });
    return snapshot;
}
exports.publishAppCoreSnapshot = publishAppCoreSnapshot;
