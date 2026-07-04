import { setStateIfChanged } from "../policy/core/state_write";
import type { PlannerHost, PlannerInputs } from "./inputs";
import { readPlannerInputs } from "./inputs";
import { buildPlannerConstraints, planBattery } from "./rules/battery";
import { computePvSurplusW } from "./rules/surplus";
import { planThermal } from "./rules/thermal";
import type { PlannerIntent } from "./types";
import { PLANNER_ENGINE_VERSION } from "./types";

let revision = 0;

export function resetPlannerRevisionForTest(): void {
	revision = 0;
}

export function runPlanner(inputs: PlannerInputs): PlannerIntent {
	const surplusW = computePvSurplusW(inputs.pvPowerW, inputs.houseLoadW);
	const constraints = buildPlannerConstraints({
		evccBatteryMode: inputs.evccBatteryMode,
		evccBatteryDischargeControl: inputs.evccBatteryDischargeControl,
		userIntentBatteryHold: inputs.userIntentBatteryHold,
	});

	const thermal = planThermal({
		surplusW,
		bufferTempC: inputs.bufferTempC,
		thermalMode: inputs.thermalMode,
		governanceEnabled: inputs.thermalGovernanceEnabled,
		config: inputs.immersionConfig,
	});

	const thermalAllocatedW = thermal.commanded_stage > 0 ? thermal.commanded_power_w : 0;
	const battery = planBattery({
		surplusW,
		socPct: inputs.socPct,
		governanceEnabled: inputs.batteryGovernanceEnabled,
		constraints,
		thermalAllocatedW,
	});

	revision += 1;
	const reasonParts: string[] = [];
	if (surplusW !== null) {
		reasonParts.push(`PV-Überschuss ${surplusW} W`);
	} else {
		reasonParts.push("PV-Überschuss unbekannt");
	}
	if (thermal.commanded_stage > 0) {
		reasonParts.push(`Heizstab Stufe ${thermal.commanded_stage}`);
	}
	if (battery.action === "charge") {
		reasonParts.push(`Batterie +${battery.max_charge_w} W`);
	}
	if (constraints.evcc_battery_hold) {
		reasonParts.push("EVCC-Hold aktiv");
	}

	return {
		schema_version: 1,
		revision,
		resolved_at: inputs.now.toISOString(),
		reason_de: reasonParts.join(". ") + ".",
		surplus_w: surplusW,
		pv_power_w: inputs.pvPowerW,
		house_load_w: inputs.houseLoadW,
		constraints,
		thermal,
		battery,
	};
}

function formatBriefing(intent: PlannerIntent): string {
	const lines: string[] = [
		`Planner v${PLANNER_ENGINE_VERSION} (dryrun-tauglich).`,
		intent.reason_de,
	];
	if (intent.thermal.commanded_stage > 0) {
		lines.push(intent.thermal.reason_de);
	} else if (intent.thermal.reason_de && !intent.thermal.reason_de.startsWith("Heizstab-Modus")) {
		lines.push(`Heizstab: ${intent.thermal.reason_de}`);
	}
	if (intent.battery.action === "charge") {
		lines.push(intent.battery.reason_de);
	} else if (intent.constraints.evcc_battery_hold) {
		lines.push(intent.battery.reason_de);
	}
	return lines.join(" ").slice(0, 480);
}

export async function runPlannerTick(host: PlannerHost): Promise<PlannerIntent> {
	const inputs = await readPlannerInputs(host);
	const intent = runPlanner(inputs);

	try {
		await setStateIfChanged(host, "planner.status", "ready");
		await setStateIfChanged(host, "planner.last_run_at", intent.resolved_at);
		await setStateIfChanged(host, "planner.surplus_w", intent.surplus_w);
		await setStateIfChanged(host, "planner.intent.last_json", JSON.stringify(intent));
		await setStateIfChanged(host, "planner.intent.last_reason_de", intent.reason_de);
		await setStateIfChanged(host, "planner.intent.thermal.commanded_stage", intent.thermal.commanded_stage);
		await setStateIfChanged(host, "planner.intent.thermal.commanded_power_w", intent.thermal.commanded_power_w);
		await setStateIfChanged(host, "planner.intent.thermal.reason_de", intent.thermal.reason_de);
		await setStateIfChanged(host, "planner.intent.battery.action", intent.battery.action);
		await setStateIfChanged(host, "planner.intent.battery.max_charge_w", intent.battery.max_charge_w);
		await setStateIfChanged(host, "planner.intent.battery.reason_de", intent.battery.reason_de);
		await setStateIfChanged(host, "planner.constraints.evcc_battery_hold", intent.constraints.evcc_battery_hold);
		await setStateIfChanged(host, "operator.briefing_de", formatBriefing(intent));
	} catch (e) {
		host.log?.warn?.(`planner state write: ${String(e)}`);
	}

	return intent;
}
