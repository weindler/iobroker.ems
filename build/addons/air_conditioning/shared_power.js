"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalAcSystemPowerW = exports.resolveAcSystemPower = void 0;
/**
 * Ein Ergebnis pro Gruppe (`sharedPowerGroupId`) bzw. pro eigenständiger Unit (`groupId: null`,
 * ein Ergebnis je Unit). Reine Funktion, kein State/IO.
 */
function resolveAcSystemPower(units) {
    const groups = new Map();
    const standalone = [];
    for (const u of units) {
        if (u.sharedPowerGroupId) {
            const arr = groups.get(u.sharedPowerGroupId) ?? [];
            arr.push(u);
            groups.set(u.sharedPowerGroupId, arr);
        }
        else {
            standalone.push(u);
        }
    }
    const results = [];
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
                totalPowerW: Math.round(measuredMember.measuredPowerW),
                activeUnitIndexes,
                sharedMeasurementUsed: true,
                measurementUnitIndex: measuredMember.unitIndex,
            });
        }
        else {
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
exports.resolveAcSystemPower = resolveAcSystemPower;
/** Gesamtsystemleistung über alle Gruppen/Standalone-Units (für Diagnose/Statistik). */
function totalAcSystemPowerW(results) {
    return Math.round(results.reduce((sum, r) => sum + r.totalPowerW, 0));
}
exports.totalAcSystemPowerW = totalAcSystemPowerW;
