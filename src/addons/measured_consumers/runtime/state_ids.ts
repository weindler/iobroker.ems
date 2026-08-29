import { padSlotIndex } from "../math";

export const MEASURED_CONSUMERS_BASE = "addons.measured_consumers";

export function measuredConsumerSlotBase(index: number): string {
	return `${MEASURED_CONSUMERS_BASE}.consumer_${padSlotIndex(index)}`;
}

export function measuredConsumerSlotStateIds(index: number) {
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

export const MEASURED_CONSUMERS_AGGREGATE_STATES = {
	totalPowerW: `${MEASURED_CONSUMERS_BASE}.total_power_w`,
	totalEnergyTodayKwh: `${MEASURED_CONSUMERS_BASE}.total_energy_today_kwh`,
	totalEnergyYesterdayKwh: `${MEASURED_CONSUMERS_BASE}.total_energy_yesterday_kwh`,
	totalEnergyMonthKwh: `${MEASURED_CONSUMERS_BASE}.total_energy_month_kwh`,
	totalEnergyYearKwh: `${MEASURED_CONSUMERS_BASE}.total_energy_year_kwh`,
	totalEnergyTotalKwh: `${MEASURED_CONSUMERS_BASE}.total_energy_total_kwh`,
	unknownHouseLoadW: `${MEASURED_CONSUMERS_BASE}.unknown_house_load_w`,
	houseLoadW: `${MEASURED_CONSUMERS_BASE}.house_load_w`,
	houseLoadAvailable: `${MEASURED_CONSUMERS_BASE}.house_load_available`,
	activeSlotCount: `${MEASURED_CONSUMERS_BASE}.active_slot_count`,
	consumersJson: `${MEASURED_CONSUMERS_BASE}.consumers_json`,
	lastTickIso: `${MEASURED_CONSUMERS_BASE}.last_tick_iso`,
	reasonDe: `${MEASURED_CONSUMERS_BASE}.reason_de`,
} as const;
