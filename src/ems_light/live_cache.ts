import { mappingBase } from "../tree_paths";
import { asBool, asNum, type StateHost } from "./state_util";

export type LiveCacheHost = StateHost & {
	getForeignStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
};

type MappingSlot = {
	addonId: string;
	role: string;
	liveId: string;
	labelDe: string;
};

const BATTERY_SLOTS: MappingSlot[] = [
	{ addonId: "battery", role: "soc_pct", liveId: "live.battery.soc_pct", labelDe: "Batterie SOC" },
	{
		addonId: "battery",
		role: "pv_ac_power_w",
		liveId: "live.battery.pv_ac_power_w",
		labelDe: "PV AC Leistung",
	},
	{
		addonId: "battery",
		role: "consumption_w",
		liveId: "live.battery.house_load_w",
		labelDe: "Hauslast",
	},
	{
		addonId: "battery",
		role: "capacity_kwh",
		liveId: "live.battery.capacity_kwh",
		labelDe: "Batteriekapazität",
	},
];

const WALLBOX_SLOTS: MappingSlot[] = [
	{
		addonId: "wallbox",
		role: "set_enabled",
		liveId: "live.wallbox.enabled",
		labelDe: "Wallbox Freigabe",
	},
	{
		addonId: "wallbox",
		role: "vehicle_soc_pct",
		liveId: "live.wallbox.vehicle_soc_pct",
		labelDe: "Fahrzeug-SOC",
	},
];

const IMMERSION_SLOTS: MappingSlot[] = [
	{
		addonId: "immersion_heater",
		role: "buffer_temp_c",
		liveId: "live.thermal.buffer_temp_c",
		labelDe: "Puffer-Temperatur",
	},
];

const TARIFF_SLOTS: MappingSlot[] = [
	{
		addonId: "dynamic_tariff",
		role: "price_now_ct_per_kwh",
		liveId: "live.price.now_ct_per_kwh",
		labelDe: "Strompreis jetzt",
	},
];

export type LiveCacheResult = {
	updated: string[];
	missing: string[];
	errors: string[];
};

async function readMappedForeign(
	host: LiveCacheHost,
	addonId: string,
	role: string,
): Promise<{ value: unknown; target: string } | null> {
	const base = mappingBase(addonId, role);
	const enabledSt = await host.getStateAsync(`${base}.enabled`);
	if (enabledSt?.val === false) {
		return null;
	}
	const targetSt = await host.getStateAsync(`${base}.target_state`);
	const target = targetSt?.val != null ? String(targetSt.val).trim() : "";
	if (!target) {
		return null;
	}
	try {
		const foreign = await host.getForeignStateAsync(target);
		if (!foreign || foreign.val === undefined || foreign.val === null) {
			return { value: null, target };
		}
		return { value: foreign.val, target };
	} catch {
		return null;
	}
}

function normalizeLiveValue(liveId: string, raw: unknown): ioBroker.StateValue | null {
	if (raw === null || raw === undefined) {
		return null;
	}
	if (liveId === "live.wallbox.enabled") {
		const b = asBool(raw);
		return b === null ? null : b ? 1 : 0;
	}
	if (liveId === "live.price.now_ct_per_kwh") {
		const eurPerKwh = asNum(raw);
		if (eurPerKwh === null) {
			return null;
		}
		// Quelle z. B. Tibber: €/kWh (0.1576) → EMS-Light ct/kWh (15.76)
		return eurPerKwh * 100;
	}
	const n = asNum(raw);
	return n;
}

async function applySlot(
	host: LiveCacheHost,
	slot: MappingSlot,
	result: LiveCacheResult,
): Promise<void> {
	const mapped = await readMappedForeign(host, slot.addonId, slot.role);
	if (!mapped) {
		result.missing.push(`${slot.labelDe} (addons.${slot.addonId}.mapping.${slot.role})`);
		return;
	}
	const normalized = normalizeLiveValue(slot.liveId, mapped.value);
	if (normalized === null) {
		result.missing.push(`${slot.labelDe} (${mapped.target}: kein Wert)`);
		return;
	}
	try {
		await host.setStateAsync(slot.liveId, { val: normalized, ack: true });
		result.updated.push(slot.liveId);
	} catch (e) {
		result.errors.push(`${slot.liveId}: ${String(e)}`);
	}
}

/** PV-Leistung zusätzlich unter live.pv.power_w (gleiche Quelle wie battery.pv_ac_power_w). */
async function mirrorPvPower(host: LiveCacheHost, result: LiveCacheResult): Promise<void> {
	const pv = await host.getStateAsync("live.battery.pv_ac_power_w");
	if (pv?.val == null || pv.val === "") {
		return;
	}
	try {
		await host.setStateAsync("live.pv.power_w", { val: pv.val, ack: true });
		result.updated.push("live.pv.power_w");
	} catch (e) {
		result.errors.push(`live.pv.power_w: ${String(e)}`);
	}
}

export async function refreshLiveCache(host: LiveCacheHost): Promise<LiveCacheResult> {
	const result: LiveCacheResult = { updated: [], missing: [], errors: [] };

	for (const slot of [...BATTERY_SLOTS, ...WALLBOX_SLOTS, ...IMMERSION_SLOTS, ...TARIFF_SLOTS]) {
		await applySlot(host, slot, result);
	}

	await mirrorPvPower(host, result);

	return result;
}

export function formatLiveCacheSummary(result: LiveCacheResult): string {
	const parts: string[] = [];
	if (result.updated.length) {
		parts.push(`Live aktualisiert: ${result.updated.length} Signal(e).`);
	}
	if (result.missing.length) {
		parts.push(`Fehlend/leer: ${result.missing.slice(0, 6).join("; ")}`);
		if (result.missing.length > 6) {
			parts.push(`… +${result.missing.length - 6} weitere`);
		}
	}
	if (result.errors.length) {
		parts.push(`Fehler: ${result.errors.join("; ")}`);
	}
	return parts.join(" ") || "Live-Cache: keine Änderungen.";
}

export function deriveHealth(result: LiveCacheResult, hasExecutionMode: boolean): string {
	if (result.errors.length > 0) {
		return "degraded";
	}
	if (!hasExecutionMode) {
		return "degraded";
	}
	if (result.updated.length === 0) {
		return "no_live_signals";
	}
	if (result.missing.length > 0) {
		return "partial";
	}
	return "ok";
}
