import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../../ems_light/state_util";
import type { MeasuredConsumerSlotConfig } from "../types";
import {
	MEASURED_CONSUMERS_AGGREGATE_STATES,
	MEASURED_CONSUMERS_BASE,
	measuredConsumerSlotStateIds,
} from "./state_ids";

function strState(id: string, name: string, def = ""): StateDef {
	return { id, common: { name, type: "string", role: "text", read: true, write: false, def }, defaultVal: def };
}

function numState(id: string, name: string, unit?: string): StateDef {
	return { id, common: { name, type: "number", role: "value", read: true, write: false, unit } };
}

function boolState(id: string, name: string, def = false): StateDef {
	return { id, common: { name, type: "boolean", role: "indicator", read: true, write: false, def }, defaultVal: def };
}

/** Aggregat-States existieren immer (unabhängig von der Anzahl konfigurierter Zeilen). */
export async function ensureMeasuredConsumersAggregateStates(host: StateHost): Promise<void> {
	await ensureChannel(host, MEASURED_CONSUMERS_BASE, "Gemessene Verbraucher");
	const s = MEASURED_CONSUMERS_AGGREGATE_STATES;
	await ensureStates(host, [
		numState(s.totalPowerW, "Gesamtleistung gemessener Verbraucher", "W"),
		numState(s.totalEnergyTodayKwh, "Energie heute (gemessene Verbraucher gesamt)", "kWh"),
		numState(s.totalEnergyYesterdayKwh, "Energie gestern (gemessene Verbraucher gesamt)", "kWh"),
		numState(s.totalEnergyMonthKwh, "Energie Monat (gemessene Verbraucher gesamt)", "kWh"),
		numState(s.totalEnergyYearKwh, "Energie Jahr (gemessene Verbraucher gesamt)", "kWh"),
		numState(s.totalEnergyTotalKwh, "Energie gesamt (gemessene Verbraucher gesamt)", "kWh"),
		numState(s.unknownHouseLoadW, "Unbekannte Restlast (Hauslast minus gemessene Verbraucher)", "W"),
		numState(s.houseLoadW, "Hauslast zum Vergleich (nur Anzeige, unverändert)", "W"),
		boolState(s.houseLoadAvailable, "Hauslast verfügbar", false),
		numState(s.activeSlotCount, "Anzahl aktiver gemessener Verbraucher"),
		strState(s.consumersJson, "Verbraucher-Liste (JSON, für künftige Charts)", "[]"),
		strState(s.lastTickIso, "Letzter Verarbeitungszeitpunkt (ISO)", ""),
		strState(s.reasonDe, "Diagnose (gesamt)", ""),
	]);
}

/** Pro-Slot-States nur für tatsächlich konfigurierte Zeilen (Admin-Tabelle) — kein 20-facher Leerlauf. */
export async function ensureMeasuredConsumerSlotStates(host: StateHost, slot: MeasuredConsumerSlotConfig): Promise<void> {
	const ids = measuredConsumerSlotStateIds(slot.index);
	await ensureChannel(host, ids.base, `Gemessener Verbraucher ${slot.index}: ${slot.name}`);
	await ensureStates(host, [
		strState(ids.name, "Name", slot.name),
		boolState(ids.enabled, "Aktiv", slot.enabled),
		numState(ids.powerW, "Leistung", "W"),
		numState(ids.energyTotalKwh, "Energie gesamt", "kWh"),
		numState(ids.energyTodayKwh, "Energie heute", "kWh"),
		numState(ids.energyYesterdayKwh, "Energie gestern", "kWh"),
		numState(ids.energyMonthKwh, "Energie Monat", "kWh"),
		numState(ids.energyYearKwh, "Energie Jahr", "kWh"),
		strState(ids.sourceMode, "Quelle (energy_state/power_integration/none)", "none"),
		boolState(ids.valid, "Gültig", false),
		strState(ids.reasonDe, "Diagnose (DE)", ""),
	]);
}

/**
 * Aggregat-Channel/States nur anlegen, wenn mindestens eine Zeile konfiguriert ist —
 * hält die States-Oberfläche bei leerer Admin-Config minimal (kein Leerlauf-Overhead).
 */
export async function ensureMeasuredConsumersStates(host: StateHost, slots: MeasuredConsumerSlotConfig[]): Promise<void> {
	if (slots.length === 0) return;
	await ensureMeasuredConsumersAggregateStates(host);
	for (const slot of slots) {
		await ensureMeasuredConsumerSlotStates(host, slot);
	}
}
