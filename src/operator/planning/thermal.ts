import type { ImmersionDeviceConfig } from "../../addons/immersion_heater/runtime/types";
import type { PlannerModePolicy } from "../../planner/mode_policy";
import type { PlannerThermalDecision } from "../../planner/types";
import { PLANNER_SURPLUS_MIN_W } from "../../planner/inputs";
import { resolveThermalForecastTarget } from "./thermal_forecast";

export interface ThermalPlanInput {
	surplusW: number | null;
	bufferTempC: number | null;
	thermalMode: "off" | "auto" | "force";
	governanceEnabled: boolean;
	config: ImmersionDeviceConfig;
	modePolicy: PlannerModePolicy;
	pvTodayKwh: number | null;
	pvTomorrowKwh: number | null;
	pvBiasStatus: string | null;
	forecastModeEnabled: boolean;
	aiOptimizationAllowed: boolean;
}

function enabledStages(config: ImmersionDeviceConfig) {
	return config.stages
		.filter((s) => s.enabled && s.nominalPowerW > 0 && s.setStateId)
		.sort((a, b) => b.nominalPowerW - a.nominalPowerW);
}

function withTarget(
	base: Omit<PlannerThermalDecision, "target_temp_c" | "target_reason_de" | "forecast_active">,
	target: ReturnType<typeof resolveThermalForecastTarget>,
): PlannerThermalDecision {
	return {
		...base,
		target_temp_c: target.targetTempC,
		target_reason_de: target.targetReasonDe,
		forecast_active: target.forecastActive,
	};
}

/** Ein/Aus: voller Überschuss muss Nennleistung tragen (kein Netzbezug). Mehrstufen: höchste passende Stufe. */
export function planThermal(input: ThermalPlanInput): PlannerThermalDecision {
	const target = resolveThermalForecastTarget({
		config: input.config,
		bufferTempC: input.bufferTempC,
		pvTodayKwh: input.pvTodayKwh,
		pvTomorrowKwh: input.pvTomorrowKwh,
		pvBiasStatus: input.pvBiasStatus,
		forecastModeEnabled: input.forecastModeEnabled,
		aiOptimizationAllowed: input.aiOptimizationAllowed,
	});

	const none = (reason: string): PlannerThermalDecision =>
		withTarget(
			{
				commanded_stage: 0,
				commanded_power_w: 0,
				reason_de: reason,
			},
			target,
		);

	if (!input.governanceEnabled) {
		return none("Heizstab-Governance deaktiviert.");
	}
	if (!input.modePolicy.allowOptimization || !input.modePolicy.allowThermalAuto) {
		return none(`${input.modePolicy.labelDe} — kein Heizstab-Auftrag.`);
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
	if (input.bufferTempC !== null && input.bufferTempC >= target.targetTempC) {
		return none(
			`Puffer ${input.bufferTempC.toFixed(1)} °C ≥ Tagesziel ${target.targetTempC} °C — kein Heizen. ${target.targetReasonDe}`,
		);
	}
	if (input.surplusW < PLANNER_SURPLUS_MIN_W) {
		return none(`PV-Überschuss ${input.surplusW} W unter Minimum ${PLANNER_SURPLUS_MIN_W} W.`);
	}

	const stages = enabledStages(input.config);
	if (stages.length === 0) {
		return none("Keine Heizstab-Stufe mit Schaltausgang und Nennleistung konfiguriert.");
	}

	// Ein/Aus (1 Stufe): binär — Überschuss muss die (konfigurierte) Nennleistung decken.
	if (input.config.stageCount === 1) {
		const stage = stages[0];
		if (input.surplusW >= stage.nominalPowerW) {
			return withTarget(
				{
					commanded_stage: stage.index,
					commanded_power_w: stage.nominalPowerW,
					reason_de: `PV-Überschuss ${input.surplusW} W → Heizstab Ein (${stage.nominalPowerW} W). Ziel ${target.targetTempC} °C.`,
				},
				target,
			);
		}
		return none(
			`PV-Überschuss ${input.surplusW} W unter ${stage.nominalPowerW} W für Ein/Aus — kein Einschalten (nur PV).`,
		);
	}

	// Mehrstufen: höchste Stufe wählen, die der Überschuss trägt.
	for (const stage of stages) {
		if (input.surplusW >= stage.nominalPowerW) {
			return withTarget(
				{
					commanded_stage: stage.index,
					commanded_power_w: stage.nominalPowerW,
					reason_de: `PV-Überschuss ${input.surplusW} W → Heizstab Stufe ${stage.index} (${stage.nominalPowerW} W). Ziel ${target.targetTempC} °C.`,
				},
				target,
			);
		}
	}

	const minRequired = stages[stages.length - 1]?.nominalPowerW ?? 0;
	return none(
		`PV-Überschuss ${input.surplusW} W reicht nicht für eine Stufe (kleinste Stufe ${minRequired} W).`,
	);
}
