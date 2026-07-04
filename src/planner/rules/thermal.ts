import type { ImmersionDeviceConfig } from "../../addons/immersion_heater/runtime/types";
import type { PlannerThermalDecision } from "../types";
import { PLANNER_SURPLUS_MIN_W } from "../inputs";

export interface ThermalPlanInput {
	surplusW: number | null;
	bufferTempC: number | null;
	thermalMode: "off" | "auto" | "force";
	governanceEnabled: boolean;
	config: ImmersionDeviceConfig;
}

export function planThermal(input: ThermalPlanInput): PlannerThermalDecision {
	const none = (reason: string): PlannerThermalDecision => ({
		commanded_stage: 0,
		commanded_power_w: 0,
		reason_de: reason,
	});

	if (!input.governanceEnabled) {
		return none("Heizstab-Governance deaktiviert.");
	}
	if (input.thermalMode !== "auto") {
		return none(`Heizstab-Modus „${input.thermalMode}“ — Planner greift nur bei auto.`);
	}
	if (input.surplusW === null) {
		return none("PV-Überschuss unbekannt (PV oder Hauslast fehlt).");
	}
	if (input.bufferTempC !== null && input.bufferTempC >= input.config.planningMaxTempC) {
		return none(
			`Puffer ${input.bufferTempC.toFixed(1)} °C ≥ Obergrenze ${input.config.planningMaxTempC} °C — kein Heizen.`,
		);
	}
	if (input.surplusW < PLANNER_SURPLUS_MIN_W) {
		return none(`PV-Überschuss ${input.surplusW} W unter Minimum ${PLANNER_SURPLUS_MIN_W} W.`);
	}

	const enabledStages = input.config.stages
		.filter((s) => s.enabled && s.nominalPowerW > 0 && s.setStateId)
		.sort((a, b) => b.nominalPowerW - a.nominalPowerW);

	for (const stage of enabledStages) {
		if (input.surplusW >= stage.nominalPowerW) {
			return {
				commanded_stage: stage.index,
				commanded_power_w: stage.nominalPowerW,
				reason_de: `PV-Überschuss ${input.surplusW} W → Heizstab Stufe ${stage.index} (${stage.nominalPowerW} W).`,
			};
		}
	}

	return none(`PV-Überschuss ${input.surplusW} W reicht für keine Heizstab-Stufe.`);
}
