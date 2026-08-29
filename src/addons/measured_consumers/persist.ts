export const MEASURED_CONSUMERS_RUNTIME_FILENAME = "measured_consumers_runtime_v1.json";

/**
 * Persistenz je Verbraucher — Schlüssel im übergeordneten Record ist der
 * `powerStateId` (stabile Identität), NICHT die Tabellenposition. So bleiben
 * Zählerstände korrekt, auch wenn der Nutzer Admin-Zeilen umsortiert/einfügt.
 */
export type MeasuredConsumerSlotPersist = {
	/** true nach dem ersten Sample — initialEnergyKwh wurde übernommen. */
	initialized: boolean;
	/** Fall A: letzter gesehener Rohzählerstand (kWh) — Basis für Delta/Reset-Erkennung. */
	rawEnergyBaselineKwh: number | null;
	/** Fall B: Zeitstempel (ms) des letzten Leistungs-Samples für die Zeitintegration. */
	lastPowerTsMs: number | null;
	/** EMS-Gesamtstand (kWh) — Quelle der Wahrheit für energy_total_kwh. */
	totalKwh: number;
	/** dateKey (YYYY-MM-DD) → an diesem Tag hinzugefügte kWh (für heute/gestern/Monat/Jahr). */
	days: Record<string, number>;
};

export function emptyMeasuredConsumerSlotPersist(): MeasuredConsumerSlotPersist {
	return {
		initialized: false,
		rawEnergyBaselineKwh: null,
		lastPowerTsMs: null,
		totalKwh: 0,
		days: {},
	};
}

export type MeasuredConsumersPersist = {
	version: 1;
	slots: Record<string, MeasuredConsumerSlotPersist>;
};

export function emptyMeasuredConsumersPersist(): MeasuredConsumersPersist {
	return { version: 1, slots: {} };
}
