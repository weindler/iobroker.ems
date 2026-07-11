import { buildBatteryContributions, type BatteryContributionBuildInput } from "./battery";
import { buildWallboxEvSessionContribution } from "./wallbox";
import { buildImmersionHeaterContributions } from "./immersion_heater";
import { buildAirConditioningContributions } from "./air_conditioning";
import type { PlanContribution } from "../../types";

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
	try {
		out.push(...buildImmersionHeaterContributions(params.immersion));
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
