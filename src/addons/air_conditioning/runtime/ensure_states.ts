import { addonBase } from "../../../tree_paths";
import { AC_UNIT_COUNT } from "../constants";

export const AC_RUNTIME_BASE = `${addonBase("air_conditioning")}.runtime`;

export function acUnitRuntimeBase(unitIndex: number): string {
	return `${addonBase("air_conditioning")}.units.unit_${unitIndex}`;
}

export function acUnitRuntimeStates(unitIndex: number): Record<string, string> {
	const base = acUnitRuntimeBase(unitIndex);
	return {
		state: `${base}.state`,
		reasonDe: `${base}.reason_de`,
		roomTempC: `${base}.room_temp_c`,
		roomHumidityPct: `${base}.room_humidity_pct`,
		feedbackSwitch: `${base}.feedback_switch`,
		running: `${base}.running`,
		cleaningActive: `${base}.cleaning_active`,
		modePurpose: `${base}.mode_purpose`,
		estimatedPowerW: `${base}.estimated_power_w`,
	};
}

export async function ensureAcRuntimeStates(host: {
	setObjectNotExistsAsync: (id: string, obj: ioBroker.Object) => Promise<unknown>;
}): Promise<void> {
	await host.setObjectNotExistsAsync(`${addonBase("air_conditioning")}.units`, {
		type: "channel",
		common: { name: "Klima Innengeräte" },
		native: {},
	} as ioBroker.Object);
	await host.setObjectNotExistsAsync(AC_RUNTIME_BASE, {
		type: "channel",
		common: { name: "Klima Runtime" },
		native: {},
	} as ioBroker.Object);
	await host.setObjectNotExistsAsync(`${AC_RUNTIME_BASE}.outdoor_allocated_power_w`, {
		type: "state",
		common: {
			name: "Klima Außengerät zugeordnete Leistung W",
			type: "number",
			role: "value",
			read: true,
			write: false,
			unit: "W",
		},
		native: {},
	} as ioBroker.Object);

	for (let i = 1; i <= AC_UNIT_COUNT; i++) {
		const ch = acUnitRuntimeBase(i);
		const ids = acUnitRuntimeStates(i);
		await host.setObjectNotExistsAsync(ch, {
			type: "channel",
			common: { name: `Klima Unit ${i}` },
			native: {},
		} as ioBroker.Object);
		const defs: Array<{ id: string; common: ioBroker.StateCommon }> = [
			{ id: ids.state, common: { name: `Klima ${i} Zustand`, type: "string", role: "text", read: true, write: false, def: "disabled" } },
			{ id: ids.reasonDe, common: { name: `Klima ${i} Grund`, type: "string", role: "text", read: true, write: false, def: "" } },
			{ id: ids.roomTempC, common: { name: `Klima ${i} Raumtemp °C`, type: "number", role: "value", read: true, write: false } },
			{ id: ids.roomHumidityPct, common: { name: `Klima ${i} Feuchte %`, type: "number", role: "value", read: true, write: false } },
			{ id: ids.feedbackSwitch, common: { name: `Klima ${i} Rückmeldung`, type: "string", role: "text", read: true, write: false, def: "" } },
			{ id: ids.running, common: { name: `Klima ${i} läuft`, type: "boolean", role: "state", read: true, write: false, def: false } },
			{ id: ids.cleaningActive, common: { name: `Klima ${i} Reinigung`, type: "boolean", role: "state", read: true, write: false, def: false } },
			{ id: ids.modePurpose, common: { name: `Klima ${i} Modus-Zweck`, type: "string", role: "text", read: true, write: false, def: "cooling" } },
			{ id: ids.estimatedPowerW, common: { name: `Klima ${i} geschätzte Leistung W`, type: "number", role: "value", read: true, write: false, def: 0 } },
		];
		for (const def of defs) {
			await host.setObjectNotExistsAsync(def.id, {
				type: "state",
				common: def.common,
				native: {},
			} as ioBroker.Object);
		}
	}
}
