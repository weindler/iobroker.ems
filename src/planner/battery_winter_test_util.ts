import type { BatteryWinterPlanConfig } from "./battery_winter_config";
import { batteryWinterPlanConfigFromAdapter } from "./battery_winter_config";
import type { BatteryWinterDayInput } from "./rules/battery_winter";

/** Test-/Default-Horizont für Planner-Inputs. */
export function defaultBatteryWinterDays(): BatteryWinterDayInput[] {
	return [
		{ dayIndex: 1, dateKey: "2026-01-01", pvKwh: 5, loadKwh: 12, pvConfidencePct: 80 },
		{ dayIndex: 2, dateKey: "2026-01-02", pvKwh: 6, loadKwh: 12, pvConfidencePct: 75 },
	];
}

export function defaultBatteryWinterConfig(config?: unknown): BatteryWinterPlanConfig {
	return batteryWinterPlanConfigFromAdapter(
		config ?? {
			battery_capacity_net_kwh: 10,
			bat_hw_max_charge_w: 4200,
			bat_hw_min_soc_pct: 5,
			bat_hw_max_soc_pct: 100,
		},
	);
}
