import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";
import type { ClimateThermalUnitModel } from "./types";

function numState(id: string, name: string, unit?: string): StateDef {
	return {
		id,
		common: { name, type: "number", role: "value", read: true, write: false, unit },
		defaultVal: null,
	};
}

function boolState(id: string, name: string): StateDef {
	return {
		id,
		common: { name, type: "boolean", role: "indicator", read: true, write: false },
		defaultVal: false,
	};
}

function strState(id: string, name: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false },
		defaultVal: "",
	};
}

export function climateThermalUnitBase(unitIndex: number): string {
	return `learning.climate_thermal.unit_${unitIndex}`;
}

export function climateThermalUnitStateIds(unitIndex: number): Record<string, string> {
	const base = climateThermalUnitBase(unitIndex);
	return {
		passiveTempRate: `${base}.passive_temp_rate_k_per_h`,
		passiveSampleCount: `${base}.passive_sample_count`,
		passiveConfidence: `${base}.passive_confidence`,
		passiveUsable: `${base}.passive_usable`,
		coolingTempRate: `${base}.cooling_temp_rate_k_per_h`,
		coolingSampleCount: `${base}.cooling_sample_count`,
		coolingConfidence: `${base}.cooling_confidence`,
		coolingUsable: `${base}.cooling_usable`,
		heatingTempRate: `${base}.heating_temp_rate_k_per_h`,
		heatingSampleCount: `${base}.heating_sample_count`,
		heatingConfidence: `${base}.heating_confidence`,
		heatingUsable: `${base}.heating_usable`,
		dehumidifyTempRate: `${base}.dehumidify_temp_rate_k_per_h`,
		dehumidifyHumidityRate: `${base}.dehumidify_humidity_rate_pct_per_h`,
		dehumidifySampleCount: `${base}.dehumidify_sample_count`,
		dehumidifyConfidence: `${base}.dehumidify_confidence`,
		dehumidifyUsable: `${base}.dehumidify_usable`,
		reasonDe: `${base}.reason_de`,
		lastRun: `${base}.last_run`,
	};
}

export async function ensureClimateThermalRootStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.climate_thermal", "EMS-Light Klima Thermal Learning");
	await ensureStates(host, [
		strState("learning.climate_thermal.summary_de", "Klima Thermal Kurzfassung"),
		strState("learning.climate_thermal.last_run", "Klima Thermal letzter Lauf"),
		numState("learning.climate_thermal.units_count", "Klima Thermal Units"),
	]);
}

export async function ensureClimateThermalStatesForUnit(host: StateHost, unitIndex: number): Promise<void> {
	const base = climateThermalUnitBase(unitIndex);
	const ids = climateThermalUnitStateIds(unitIndex);
	await ensureChannel(host, base, `Klima Thermal Unit ${unitIndex}`);
	await ensureStates(host, [
		numState(ids.passiveTempRate, `Unit ${unitIndex} passiv K/h`, "K/h"),
		numState(ids.passiveSampleCount, `Unit ${unitIndex} passiv Samples`),
		numState(ids.passiveConfidence, `Unit ${unitIndex} passiv Confidence`),
		boolState(ids.passiveUsable, `Unit ${unitIndex} passiv usable`),
		numState(ids.coolingTempRate, `Unit ${unitIndex} Cooling K/h`, "K/h"),
		numState(ids.coolingSampleCount, `Unit ${unitIndex} Cooling Samples`),
		numState(ids.coolingConfidence, `Unit ${unitIndex} Cooling Confidence`),
		boolState(ids.coolingUsable, `Unit ${unitIndex} Cooling usable`),
		numState(ids.heatingTempRate, `Unit ${unitIndex} Heating K/h`, "K/h"),
		numState(ids.heatingSampleCount, `Unit ${unitIndex} Heating Samples`),
		numState(ids.heatingConfidence, `Unit ${unitIndex} Heating Confidence`),
		boolState(ids.heatingUsable, `Unit ${unitIndex} Heating usable`),
		numState(ids.dehumidifyTempRate, `Unit ${unitIndex} Dehumidify K/h`, "K/h"),
		numState(ids.dehumidifyHumidityRate, `Unit ${unitIndex} Dehumidify %RH/h`, "%RH/h"),
		numState(ids.dehumidifySampleCount, `Unit ${unitIndex} Dehumidify Samples`),
		numState(ids.dehumidifyConfidence, `Unit ${unitIndex} Dehumidify Confidence`),
		boolState(ids.dehumidifyUsable, `Unit ${unitIndex} Dehumidify usable`),
		strState(ids.reasonDe, `Unit ${unitIndex} Begründung`),
		strState(ids.lastRun, `Unit ${unitIndex} letzter Lauf`),
	]);
}

function rateOrNull(status: string, rate: number | null): number | null {
	if (status === "unavailable" || status === "not_evaluable") return null;
	return rate;
}

export async function publishClimateThermalUnit(
	host: StateHost & { setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown> },
	model: ClimateThermalUnitModel,
): Promise<void> {
	const ids = climateThermalUnitStateIds(model.unitIndex);
	const dryCount = Math.max(model.dehumidify.temp.sampleCount, model.dehumidify.humidity.sampleCount);
	const dryConf = Math.max(model.dehumidify.temp.confidence, model.dehumidify.humidity.confidence);
	const dryUsable = model.dehumidify.temp.usable || model.dehumidify.humidity.usable;
	await host.setStateAsync(ids.passiveTempRate, {
		val: rateOrNull(model.passive.status, model.passive.rate),
		ack: true,
	});
	await host.setStateAsync(ids.passiveSampleCount, { val: model.passive.sampleCount, ack: true });
	await host.setStateAsync(ids.passiveConfidence, { val: model.passive.confidence, ack: true });
	await host.setStateAsync(ids.passiveUsable, { val: model.passive.usable, ack: true });
	await host.setStateAsync(ids.coolingTempRate, {
		val: rateOrNull(model.cooling.status, model.cooling.rate),
		ack: true,
	});
	await host.setStateAsync(ids.coolingSampleCount, { val: model.cooling.sampleCount, ack: true });
	await host.setStateAsync(ids.coolingConfidence, { val: model.cooling.confidence, ack: true });
	await host.setStateAsync(ids.coolingUsable, { val: model.cooling.usable, ack: true });
	await host.setStateAsync(ids.heatingTempRate, {
		val: rateOrNull(model.heating.status, model.heating.rate),
		ack: true,
	});
	await host.setStateAsync(ids.heatingSampleCount, { val: model.heating.sampleCount, ack: true });
	await host.setStateAsync(ids.heatingConfidence, { val: model.heating.confidence, ack: true });
	await host.setStateAsync(ids.heatingUsable, { val: model.heating.usable, ack: true });
	await host.setStateAsync(ids.dehumidifyTempRate, {
		val: rateOrNull(model.dehumidify.temp.status, model.dehumidify.temp.rate),
		ack: true,
	});
	await host.setStateAsync(ids.dehumidifyHumidityRate, {
		val: rateOrNull(model.dehumidify.humidity.status, model.dehumidify.humidity.rate),
		ack: true,
	});
	await host.setStateAsync(ids.dehumidifySampleCount, { val: dryCount, ack: true });
	await host.setStateAsync(ids.dehumidifyConfidence, { val: dryConf, ack: true });
	await host.setStateAsync(ids.dehumidifyUsable, { val: dryUsable, ack: true });
	await host.setStateAsync(ids.reasonDe, { val: model.reasonDe, ack: true });
	await host.setStateAsync(ids.lastRun, { val: model.lastRunIso ?? "", ack: true });
}
