import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";
import { MODULE_TAG } from "./constants";
import type { BatteryRuntimeComputeResult, BatteryRuntimePersist } from "./types";

export async function writeBatteryRuntimePersist(
	baseDir: string,
	result: BatteryRuntimeComputeResult,
	lastRun: string,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	const payload: BatteryRuntimePersist = {
		generated_at: lastRun,
		module: MODULE_TAG,
		sample_days: result.sampleDays,
		avg_night_discharge_pct: result.avgNightDischargePct,
		avg_night_discharge_kwh: result.avgNightDischargeKwh,
		predicted_night_consumption_kwh: result.predictedNightConsumptionKwh,
		night_consumption_valid_nights: result.nightConsumptionValidNights,
		predicted_night_grid_import_kwh: result.predictedNightGridImportKwh,
		avg_night_load_w: result.avgNightLoadW,
		required_soc_at_pv_end_pct: result.requiredSocAtPvEndPct,
		required_night_reserve_kwh: result.requiredNightReserveKwh,
		night_bridge_method: result.nightBridgeMethod,
		night_bridge_valid_nights: result.nightBridgeValidNights,
		avg_night_bridge_hours: result.avgNightBridgeHours,
		grid_balance_attributed_nights: result.gridBalanceAttributedNights,
		grid_balance_excluded_nights: result.gridBalanceExcludedNights,
		avg_charge_rate_pct_h: result.avgChargeRatePctH,
		avg_discharge_rate_pct_h: result.avgDischargeRatePctH,
		avg_charge_power_w: result.avgChargePowerW,
		avg_discharge_power_w: result.avgDischargePowerW,
		max_charge_power_w: result.maxChargePowerW,
		max_discharge_power_w: result.maxDischargePowerW,
		last_full_charge: result.lastFullCharge,
		days_since_full: result.daysSinceFull,
		topoff_interval_days: result.topoffIntervalDays,
		topoff_days_remaining: result.topoffDaysRemaining,
		topoff_due: result.topoffDue,
		estimated_runtime_days: result.estimatedRuntimeDays,
	};
	await atomicWriteFile(
		path.join(baseDir, "battery_runtime_learning_v1.json"),
		`${JSON.stringify(payload, null, 2)}\n`,
	);
}

export async function readBatteryRuntimePersist(
	baseDir: string,
): Promise<BatteryRuntimePersist | null> {
	try {
		const raw = await fs.readFile(
			path.join(baseDir, "battery_runtime_learning_v1.json"),
			"utf8",
		);
		return JSON.parse(raw) as BatteryRuntimePersist;
	} catch {
		return null;
	}
}
