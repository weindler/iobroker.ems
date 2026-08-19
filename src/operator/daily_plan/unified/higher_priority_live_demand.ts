import type { UnifiedClimateInput, UnifiedWallboxInput } from "./types";

export type HigherPriorityLiveDemandInput = {
	wbLiveWriteAllowed: boolean;
	wbConnected: boolean | null;
	wallbox: UnifiedWallboxInput | null;
	/** Ist-Ladeleistung EVCC jetzt, W; null = unbekannt. */
	evccChargePowerNow: number | null;
	acLiveWriteAllowed: boolean;
	climate: UnifiedClimateInput | null;
};

/**
 * B1-Reservierung: wie viel Leistung (W) höher priorisierte LIVE-Verbraucher
 * (Wallbox mit Restbedarf, mandatory Klima über Comfort-Max) vom Live-PV-Überschuss
 * vor dem Heizstab beanspruchen dürfen.
 *
 * Wichtig — kein Doppelzählen: Läuft ein Verbraucher bereits, steckt sein Ist-Verbrauch
 * schon im Live-Hausverbrauch (Ganzhausmesser) und damit schon im Live-Überschuss selbst
 * (`surplusW = PV − houseLoadW`). Reserviert werden darf hier nur die Differenz zur
 * Ziel-/Typischleistung (z. B. Hochlauf-Kompressor, noch nicht erreichte Ladeleistung) —
 * nicht der volle Nominalwert, sonst wird der laufende Verbrauch zweimal abgezogen.
 */
export function computeHigherPriorityLiveDemandW(input: HigherPriorityLiveDemandInput): number {
	let total = 0;

	if (input.wbLiveWriteAllowed && input.wbConnected === true) {
		const need = input.wallbox?.requiredEnergyKwh;
		if (need != null && need > 0.5) {
			const maxW = input.wallbox?.maxChargePowerW;
			const minW = input.wallbox?.minChargePowerW;
			let reserve = 3500;
			if (minW != null && minW > 0) reserve = Math.max(reserve, minW);
			if (maxW != null && maxW > 0) reserve = Math.min(reserve, maxW);
			const alreadyDrawnW = Math.max(0, input.evccChargePowerNow ?? 0);
			total += Math.max(0, reserve - alreadyDrawnW);
		}
	}

	if (input.acLiveWriteAllowed && input.climate) {
		for (const u of input.climate.units) {
			if (!u.mandatoryComfort) continue;
			if (u.roomTempC == null || u.comfortMaxC == null) continue;
			if (u.roomTempC <= u.comfortMaxC) continue;
			const need = Math.max(u.typicalPowerW ?? 700, 500);
			/** holdPowerW ist die beste verfügbare Schätzung des laufenden Ist-Verbrauchs. */
			const alreadyDrawnW = u.hardwareRunning
				? Math.max(0, Math.min(need, u.holdPowerW ?? need))
				: 0;
			total += Math.max(0, need - alreadyDrawnW);
		}
	}

	return total;
}
