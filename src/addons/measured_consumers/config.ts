import { MEASURED_CONSUMERS_CONFIG_KEY, MEASURED_CONSUMERS_SLOT_COUNT } from "./constants";
import type { MeasuredConsumerSlotConfig } from "./types";

function asStr(v: unknown): string {
	if (typeof v === "string") return v.trim();
	if (v === null || v === undefined) return "";
	return String(v).trim();
}

function asBoolField(v: unknown, def: boolean): boolean {
	if (typeof v === "boolean") return v;
	if (typeof v === "number") return v !== 0;
	const s = asStr(v).toLowerCase();
	if (["1", "true", "on", "yes", "ja"].includes(s)) return true;
	if (["0", "false", "off", "no", "nein"].includes(s)) return false;
	return def;
}

function asOptionalNum(v: unknown): number | null {
	if (v === null || v === undefined || v === "") return null;
	const n = typeof v === "number" ? v : parseFloat(asStr(v).replace(",", "."));
	return Number.isFinite(n) ? n : null;
}

/**
 * Liest die Admin-Tabelle generisch als Liste (kein Sonderpfad je Zeile).
 * Zeilen über der festen Kapazität (20) werden ignoriert (Aufrufer kann warnen).
 */
export function configuredMeasuredConsumerSlots(config: unknown): MeasuredConsumerSlotConfig[] {
	const raw = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const rows = Array.isArray(raw[MEASURED_CONSUMERS_CONFIG_KEY]) ? (raw[MEASURED_CONSUMERS_CONFIG_KEY] as unknown[]) : [];
	const out: MeasuredConsumerSlotConfig[] = [];
	for (const row of rows) {
		if (out.length >= MEASURED_CONSUMERS_SLOT_COUNT) break;
		const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
		const index = out.length + 1;
		const powerStateId = asStr(r.power_state_id);
		const energyStateId = asStr(r.energy_state_id);
		out.push({
			index,
			enabled: asBoolField(r.enabled, true),
			name: asStr(r.name) || `Verbraucher ${index}`,
			powerStateId: powerStateId || null,
			energyStateId: energyStateId || null,
			initialEnergyKwh: asOptionalNum(r.initial_energy_kwh),
		});
	}
	return out;
}

/** Anzahl konfigurierter Zeilen jenseits der Admin-Kapazität (für einmalige Warnung beim Start). */
export function measuredConsumerOverflowCount(config: unknown): number {
	const raw = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const rows = Array.isArray(raw[MEASURED_CONSUMERS_CONFIG_KEY]) ? (raw[MEASURED_CONSUMERS_CONFIG_KEY] as unknown[]) : [];
	return Math.max(0, rows.length - MEASURED_CONSUMERS_SLOT_COUNT);
}
