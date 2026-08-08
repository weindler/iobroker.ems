import { buildBatteryContributions, type BatteryContributionBuildInput } from "./battery";
import { buildWallboxEvSessionContribution } from "./wallbox";
import { buildImmersionHeaterContributions } from "./immersion_heater";
import { buildAirConditioningContributions } from "./air_conditioning";
import type { PlanContribution } from "../../types";
import { CONTRIBUTION_IDS } from "../../contribution_ids";

function numDetail(c: PlanContribution | undefined, key: string): number | null {
	const v = c?.details?.[key];
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function buildFlexibleContributions(params: {
	battery: BatteryContributionBuildInput;
	wallbox: Parameters<typeof buildWallboxEvSessionContribution>[0];
	immersion: Parameters<typeof buildImmersionHeaterContributions>[0];
	airConditioning: Parameters<typeof buildAirConditioningContributions>[0];
}): PlanContribution[] {
	const out: PlanContribution[] = [];
	try {
		out.push(...buildBatteryContributions(params.battery));
	} catch {
		// isoliert — andere Add-ons weiter
	}
	try {
		out.push(buildWallboxEvSessionContribution(params.wallbox));
	} catch {
		// isoliert
	}

	const batCharge = out.find((c) => c.contributionId === CONTRIBUTION_IDS.BATTERY_CHARGE);
	const wb = out.find((c) => c.contributionId === CONTRIBUTION_IDS.WALLBOX_EV_SESSION);
	const immersionInput = {
		...params.immersion,
		todayPvSurplusKwh: params.immersion.todayPvSurplusKwh ?? params.battery.todayPvSurplusKwh ?? null,
		batterySocPct: params.immersion.batterySocPct ?? params.battery.socPct ?? null,
		batteryEndSocTargetPct:
			params.immersion.batteryEndSocTargetPct ?? numDetail(batCharge, "targetSocPct"),
		vehicleUrgentEnergyKwh:
			params.immersion.vehicleUrgentEnergyKwh ?? numDetail(wb, "requiredEnergyKwh"),
		futureElectricalFlexHintKwh: params.immersion.futureElectricalFlexHintKwh ?? null,
	};

	try {
		out.push(...buildImmersionHeaterContributions(immersionInput));
	} catch {
		// isoliert
	}
	try {
		out.push(...buildAirConditioningContributions(params.airConditioning));
	} catch {
		// isoliert
	}
	return out;
}
