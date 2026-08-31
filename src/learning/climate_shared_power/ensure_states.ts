import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";
import type { ClimateSharedPowerStat } from "./types";

function numState(id: string, name: string, unit?: string): StateDef {
	return {
		id,
		common: { name, type: "number", role: "value", read: true, write: false, unit },
		defaultVal: null,
	};
}

function strState(id: string, name: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false },
		defaultVal: "",
	};
}

/** Stabile, ioBroker-taugliche ID aus Gruppe/Modus/Kombination (keine Sonderzeichen außer `_`). */
export function climateSharedPowerStateSlug(groupId: string, mode: string, combo: string): string {
	const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
	return `${clean(groupId)}_${clean(mode)}_${clean(combo.replace(/\+/g, "p"))}`;
}

export function climateSharedPowerBaseForSlug(slug: string): string {
	return `learning.climate_shared_power.${slug}`;
}

export function climateSharedPowerStateIdsForSlug(slug: string): Record<string, string> {
	const base = climateSharedPowerBaseForSlug(slug);
	return {
		medianPowerW: `${base}.median_power_w`,
		p75PowerW: `${base}.p75_power_w`,
		spreadW: `${base}.spread_w`,
		sampleCount: `${base}.sample_count`,
		confidence: `${base}.confidence_pct`,
		ageDays: `${base}.age_days`,
		lastSampleAt: `${base}.last_sample_at`,
	};
}

export async function ensureClimateSharedPowerRootStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.climate_shared_power", "EMS-Light Klima Shared-Power Learning");
	await ensureStates(host, [
		strState("learning.climate_shared_power.summary_de", "Klima Shared-Power Kurzfassung"),
		numState("learning.climate_shared_power.combinations_count", "Klima Shared-Power Kombinationen"),
	]);
}

export async function ensureClimateSharedPowerStatesForSlug(
	host: StateHost,
	slug: string,
	label: string,
): Promise<void> {
	const base = climateSharedPowerBaseForSlug(slug);
	const ids = climateSharedPowerStateIdsForSlug(slug);
	await ensureChannel(host, base, `Klima Shared-Power ${label}`);
	await ensureStates(host, [
		numState(ids.medianPowerW, `${label} Median-Leistung`, "W"),
		numState(ids.p75PowerW, `${label} p75-Leistung (Planner-Wert)`, "W"),
		numState(ids.spreadW, `${label} Streuung (IQR)`, "W"),
		numState(ids.sampleCount, `${label} Sample-Anzahl`),
		numState(ids.confidence, `${label} Confidence`, "%"),
		numState(ids.ageDays, `${label} Alter letzte Probe`, "d"),
		strState(ids.lastSampleAt, `${label} letzte Probe`),
	]);
}

export async function publishClimateSharedPowerStat(
	host: StateHost & { setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown> },
	slug: string,
	stat: ClimateSharedPowerStat,
): Promise<void> {
	const ids = climateSharedPowerStateIdsForSlug(slug);
	await host.setStateAsync(ids.medianPowerW, { val: stat.medianPowerW, ack: true });
	await host.setStateAsync(ids.p75PowerW, { val: stat.p75PowerW, ack: true });
	await host.setStateAsync(ids.spreadW, { val: stat.spreadW, ack: true });
	await host.setStateAsync(ids.sampleCount, { val: stat.sampleCount, ack: true });
	await host.setStateAsync(ids.confidence, { val: Math.round(stat.confidence * 100), ack: true });
	await host.setStateAsync(ids.ageDays, { val: stat.ageDays, ack: true });
	await host.setStateAsync(ids.lastSampleAt, { val: stat.lastSampleAtIso ?? "", ack: true });
}
