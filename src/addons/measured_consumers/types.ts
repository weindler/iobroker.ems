/** Herkunft der Energie-Akkumulation für einen gemessenen Verbraucher. */
export type MeasuredConsumerSourceMode = "energy_state" | "power_integration" | "none";

/** Ein konfigurierter Slot aus der Admin-Tabelle (Position = Anzeige-Reihenfolge). */
export type MeasuredConsumerSlotConfig = {
	/** 1-basierte Position in der Admin-Tabelle — nur für den State-Pfad (consumer_01…20). */
	index: number;
	enabled: boolean;
	name: string;
	/** Aktuelle Leistung (W). Ohne diesen Datenpunkt ist der Slot ungültig. */
	powerStateId: string | null;
	/** Optional: kumulativer Energiezähler (kWh). Wenn vorhanden, bevorzugte Quelle (Fall A). */
	energyStateId: string | null;
	/**
	 * Gewünschter EMS-Gesamtstand beim ERSTEN Initialisieren dieses Slots
	 * (nicht additiv, kein Offset-Feld) — z. B. vorhandener Zählerstand/SourceAnalytix-Historie.
	 * null = ohne Vorgabe (Fall A: Rohzähler direkt übernehmen; Fall B: bei 0 starten).
	 */
	initialEnergyKwh: number | null;
};
