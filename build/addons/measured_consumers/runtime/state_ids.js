"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEASURED_CONSUMERS_AGGREGATE_STATES = exports.measuredConsumerSlotStateIds = exports.measuredConsumerSlotBase = exports.MEASURED_CONSUMERS_BASE = void 0;
const math_1 = require("../math");
exports.MEASURED_CONSUMERS_BASE = "addons.measured_consumers";
function measuredConsumerSlotBase(index) {
    return `${exports.MEASURED_CONSUMERS_BASE}.consumer_${(0, math_1.padSlotIndex)(index)}`;
}
exports.measuredConsumerSlotBase = measuredConsumerSlotBase;
function measuredConsumerSlotStateIds(index) {
    const base = measuredConsumerSlotBase(index);
    return {
        base,
        name: `${base}.name`,
        enabled: `${base}.enabled`,
        powerW: `${base}.power_w`,
        energyTotalKwh: `${base}.energy_total_kwh`,
        energyTodayKwh: `${base}.energy_today_kwh`,
        energyYesterdayKwh: `${base}.energy_yesterday_kwh`,
        energyMonthKwh: `${base}.energy_month_kwh`,
        energyYearKwh: `${base}.energy_year_kwh`,
        sourceMode: `${base}.source_mode`,
        valid: `${base}.valid`,
        reasonDe: `${base}.reason_de`,
    };
}
exports.measuredConsumerSlotStateIds = measuredConsumerSlotStateIds;
exports.MEASURED_CONSUMERS_AGGREGATE_STATES = {
    totalPowerW: `${exports.MEASURED_CONSUMERS_BASE}.total_power_w`,
    totalEnergyTodayKwh: `${exports.MEASURED_CONSUMERS_BASE}.total_energy_today_kwh`,
    totalEnergyYesterdayKwh: `${exports.MEASURED_CONSUMERS_BASE}.total_energy_yesterday_kwh`,
    totalEnergyMonthKwh: `${exports.MEASURED_CONSUMERS_BASE}.total_energy_month_kwh`,
    totalEnergyYearKwh: `${exports.MEASURED_CONSUMERS_BASE}.total_energy_year_kwh`,
    totalEnergyTotalKwh: `${exports.MEASURED_CONSUMERS_BASE}.total_energy_total_kwh`,
    unknownHouseLoadW: `${exports.MEASURED_CONSUMERS_BASE}.unknown_house_load_w`,
    houseLoadW: `${exports.MEASURED_CONSUMERS_BASE}.house_load_w`,
    houseLoadAvailable: `${exports.MEASURED_CONSUMERS_BASE}.house_load_available`,
    activeSlotCount: `${exports.MEASURED_CONSUMERS_BASE}.active_slot_count`,
    consumersJson: `${exports.MEASURED_CONSUMERS_BASE}.consumers_json`,
    lastTickIso: `${exports.MEASURED_CONSUMERS_BASE}.last_tick_iso`,
    reasonDe: `${exports.MEASURED_CONSUMERS_BASE}.reason_de`,
};
