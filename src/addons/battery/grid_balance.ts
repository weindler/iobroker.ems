/** Netzausgleich-Logik — rein, ohne ioBroker. */

export type BatteryController = "idle" | "grid_balance" | "grid_charge_winter" | "ems";

export interface GridBalanceInputs {
	effectiveRestOfDayKwh: number;
	capacityWh: number;
	snowCoverSuspected: boolean;
	consumptionW: number;
	pvAcPowerW: number;
	socPct: number | null;
	emsGridBalanceEnabled: boolean;
	adapterFeatureEnabled: boolean;
	controller: BatteryController;
	offsetHighSocW: number;
	offsetLowSocW: number;
	socThresholdPct: number;
}

export interface GridBalanceResult {
	active: boolean;
	gatePassed: boolean;
	targetBatteryChargingW: number;
	reasonDe: string;
	checksPassed: string[];
	checksFailed: string[];
}

export function computeGridBalanceTarget(inputs: GridBalanceInputs): GridBalanceResult {
	const checksPassed: string[] = [];
	const checksFailed: string[] = [];

	if (inputs.controller !== "grid_balance") {
		checksFailed.push("controller_not_grid_balance");
		return inactive(`Controller=${inputs.controller}`, checksPassed, checksFailed);
	}
	checksPassed.push("controller_grid_balance");

	if (!inputs.adapterFeatureEnabled) {
		checksFailed.push("adapter_feature_disabled");
		return inactive("Netzausgleich im Adapter deaktiviert", checksPassed, checksFailed);
	}
	checksPassed.push("adapter_feature_enabled");

	if (!inputs.emsGridBalanceEnabled) {
		checksFailed.push("ems_grid_balance_disabled");
		return inactive("EMS: grid_balance_enabled=false", checksPassed, checksFailed);
	}
	checksPassed.push("ems_grid_balance_enabled");

	if (inputs.snowCoverSuspected) {
		checksFailed.push("snow_cover_suspected");
		return inactive("Schnee-/Ertrags-Verdacht (EMS)", checksPassed, checksFailed);
	}
	checksPassed.push("no_snow");

	const cap = inputs.capacityWh;
	if (!(cap > 0)) {
		checksFailed.push("capacity_missing");
		return inactive("ems_mirror.capacity_wh fehlt", checksPassed, checksFailed);
	}
	checksPassed.push("capacity_ok");

	const restWh = inputs.effectiveRestOfDayKwh * 1000;
	if (!(restWh >= cap)) {
		checksFailed.push("pv_forecast_below_capacity");
		return inactive(
			`Rest-PV ${inputs.effectiveRestOfDayKwh.toFixed(2)} kWh < Kapazität ${(cap / 1000).toFixed(2)} kWh`,
			checksPassed,
			checksFailed,
		);
	}
	checksPassed.push("pv_forecast_gate");

	if (!(inputs.consumptionW > inputs.pvAcPowerW)) {
		checksFailed.push("no_grid_import");
		return inactive("consumption_w <= pv_ac_power_w", checksPassed, checksFailed);
	}
	checksPassed.push("consumption_gt_pv");

	const offset =
		inputs.socPct != null && inputs.socPct > inputs.socThresholdPct
			? inputs.offsetHighSocW
			: inputs.offsetLowSocW;
	checksPassed.push(`offset_${offset}w`);

	const target = Math.max(0, Math.round(inputs.consumptionW - inputs.pvAcPowerW + offset));
	return {
		active: true,
		gatePassed: true,
		targetBatteryChargingW: target,
		reasonDe: `Netzausgleich: ${target} W (consumption − pv + ${offset} W)`,
		checksPassed,
		checksFailed,
	};
}

function inactive(
	reasonDe: string,
	checksPassed: string[],
	checksFailed: string[],
): GridBalanceResult {
	return {
		active: false,
		gatePassed: false,
		targetBatteryChargingW: 0,
		reasonDe,
		checksPassed,
		checksFailed,
	};
}

export function resolveController(params: {
	emsBatteryIntentActive: boolean;
	emsGridBalanceEnabled: boolean;
	adapterFeatureEnabled: boolean;
	batteryAddonEnabled: boolean;
	gridBalancePaused: boolean;
}): BatteryController {
	if (params.emsBatteryIntentActive || params.gridBalancePaused) {
		return "ems";
	}
	if (params.emsGridBalanceEnabled && params.adapterFeatureEnabled && params.batteryAddonEnabled) {
		return "grid_balance";
	}
	return "idle";
}
