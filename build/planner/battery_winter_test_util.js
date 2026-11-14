"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultBatteryWinterDays = defaultBatteryWinterDays;
exports.defaultBatteryWinterConfig = defaultBatteryWinterConfig;
const battery_winter_config_1 = require("./battery_winter_config");
/** Test-/Default-Horizont für Planner-Inputs. */
function defaultBatteryWinterDays() {
    return [
        { dayIndex: 1, dateKey: "2026-01-01", pvKwh: 5, loadKwh: 12, pvConfidencePct: 80 },
        { dayIndex: 2, dateKey: "2026-01-02", pvKwh: 6, loadKwh: 12, pvConfidencePct: 75 },
    ];
}
function defaultBatteryWinterConfig(config) {
    return (0, battery_winter_config_1.batteryWinterPlanConfigFromAdapter)(config ?? {
        battery_capacity_net_kwh: 10,
        bat_hw_max_charge_w: 4200,
        bat_hw_min_soc_pct: 5,
        bat_hw_max_soc_pct: 100,
    });
}
