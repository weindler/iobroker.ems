/**
 * Gemeinsame Außengeräte-Leistung (Klima-/Ownership-Block).
 *
 * Reale Besonderheit: Bei manchen Multi-Split-Systemen (hier: „Josef Zimmer“) liefert die
 * Leistungs-/Energie-Zuordnung eines Innengeräts den Wert des GEMEINSAMEN Außengeräts, nicht
 * den Einzelverbrauch dieses Innengeräts. Läuft nur ein Innengerät der Gruppe, ist der gemessene
 * Wert schon die volle Anlagenleistung; laufen mehrere, darf er nicht zusätzlich addiert werden.
 *
 * Trennung (bewusst): Komfortzustand bleibt pro Innengerät (`activeUnitIndexes`), die elektrische
 * Leistung ist eine EINE Systemgröße pro Gruppe (`totalPowerW`). Einheiten ohne `sharedPowerGroupId`
 * verhalten sich unverändert wie bisher (volle Rückwärtskompatibilität, kein Sonderfall nötig).
 */

export type AcUnitLiveState = {
	unitIndex: number;
	/** null = eigenständige Leistungsmessung (bisheriges Verhalten, unverändert). */
	sharedPowerGroupId: string | null;
	/** Komfort-Betriebszustand dieses Innengeräts (unabhängig von der Leistungsmessung). */
	running: boolean;
	/** Reale Messung, falls für DIESES Innengerät (oder dessen Sensor-Mapping) verfügbar. */
	measuredPowerW: number | null;
	estimatedPowerW: number;
};

export type AcGroupPowerResult = {
	/** null = eigenständige (nicht gruppierte) Unit. */
	groupId: string | null;
	/** Einmalige Systemleistung (W) — nie doppelt gezählt, auch wenn mehrere Units laufen. */
	totalPowerW: number;
	/** Innengeräte mit aktuellem Komfortbedarf (können mehrere sein, auch bei gemeinsamer Messung). */
	activeUnitIndexes: number[];
	sharedMeasurementUsed: boolean;
	/** Welche Unit die reale Messung liefert (z. B. der Sensor am Außengerät-Mapping). */
	measurementUnitIndex: number | null;
};

/**
 * Ein Ergebnis pro Gruppe (`sharedPowerGroupId`) bzw. pro eigenständiger Unit (`groupId: null`,
 * ein Ergebnis je Unit). Reine Funktion, kein State/IO.
 */
export function resolveAcSystemPower(units: AcUnitLiveState[]): AcGroupPowerResult[] {
	const groups = new Map<string, AcUnitLiveState[]>();
	const standalone: AcUnitLiveState[] = [];
	for (const u of units) {
		if (u.sharedPowerGroupId) {
			const arr = groups.get(u.sharedPowerGroupId) ?? [];
			arr.push(u);
			groups.set(u.sharedPowerGroupId, arr);
		} else {
			standalone.push(u);
		}
	}

	const results: AcGroupPowerResult[] = [];

	for (const u of standalone) {
		results.push({
			groupId: null,
			totalPowerW: u.running ? Math.round(u.measuredPowerW ?? u.estimatedPowerW) : 0,
			activeUnitIndexes: u.running ? [u.unitIndex] : [],
			sharedMeasurementUsed: false,
			measurementUnitIndex: u.running && u.measuredPowerW !== null ? u.unitIndex : null,
		});
	}

	for (const [groupId, members] of groups) {
		const activeMembers = members.filter((m) => m.running);
		const activeUnitIndexes = activeMembers.map((m) => m.unitIndex).sort((a, b) => a - b);
		if (activeMembers.length === 0) {
			results.push({
				groupId,
				totalPowerW: 0,
				activeUnitIndexes: [],
				sharedMeasurementUsed: false,
				measurementUnitIndex: null,
			});
			continue;
		}
		/*
		 * Die reale Messung (Außengerät) gilt unabhängig vom eigenen Komfort-Betriebszustand des
		 * Innengeräts, an dem der Sensor hängt — sie zeigt an, was das Außengerät JETZT zieht,
		 * ausgelöst durch IRGENDEIN Innengerät der Gruppe.
		 */
		const measuredMember = members.find((m) => m.measuredPowerW !== null);
		if (measuredMember) {
			results.push({
				groupId,
				totalPowerW: Math.round(measuredMember.measuredPowerW!),
				activeUnitIndexes,
				sharedMeasurementUsed: true,
				measurementUnitIndex: measuredMember.unitIndex,
			});
		} else {
			// Keine reale Messung in der Gruppe — konservative Schätzsumme, kein Fake-Sensor-Wert.
			const estimatedTotal = activeMembers.reduce((sum, m) => sum + m.estimatedPowerW, 0);
			results.push({
				groupId,
				totalPowerW: Math.round(estimatedTotal),
				activeUnitIndexes,
				sharedMeasurementUsed: false,
				measurementUnitIndex: null,
			});
		}
	}

	return results;
}

/** Gesamtsystemleistung über alle Gruppen/Standalone-Units (für Diagnose/Statistik). */
export function totalAcSystemPowerW(results: AcGroupPowerResult[]): number {
	return Math.round(results.reduce((sum, r) => sum + r.totalPowerW, 0));
}
