"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateAcUnitFsm = void 0;
const config_1 = require("../config");
const time_1 = require("./time");
const hard_off_worth_it_1 = require("./hard_off_worth_it");
function evaluateAcUnitFsm(input) {
    const { unit } = input;
    const none = (state, reasonDe) => ({
        state,
        demandStart: false,
        demandStop: false,
        modePurpose: "cooling",
        reasonDe,
        demandUrgency01: 0,
    });
    if (!input.addonEnabled || !unit.enabled) {
        return none("disabled", "Add-on oder Innengerät deaktiviert.");
    }
    if (input.cleaningActive) {
        return none("cleaning", "Reinigung aktiv — Kühlung gesperrt.");
    }
    const nowMin = input.now.getHours() * 60 + input.now.getMinutes();
    if ((0, time_1.isHardOffTime)(nowMin, unit.hardOffAt)) {
        if ((0, time_1.switchIsOn)(input.feedbackSwitchRaw)) {
            return {
                state: "running",
                demandStart: false,
                demandStop: true,
                modePurpose: "cooling",
                reasonDe: `Hard-Off ${unit.hardOffAt} — Abschaltung.`,
                demandUrgency01: 0,
            };
        }
        return none("idle", `Hard-Off ${unit.hardOffAt} — außerhalb Betrieb.`);
    }
    if (!(0, time_1.isWithinClockWindow)(nowMin, unit.activeFrom, unit.activeUntil)) {
        if ((0, time_1.switchIsOn)(input.feedbackSwitchRaw)) {
            return {
                state: "running",
                demandStart: false,
                demandStop: true,
                modePurpose: "cooling",
                reasonDe: `Außerhalb Zeitfenster ${unit.activeFrom}–${unit.activeUntil}.`,
                demandUrgency01: 0,
            };
        }
        return none("idle", `Außerhalb Zeitfenster ${unit.activeFrom}–${unit.activeUntil}.`);
    }
    const temp = input.roomTempC;
    if (temp === null) {
        // Already running without a readable temp: do not invent a stop, but also do not
        // pretend we evaluated off-temp (operator sees reason_de).
        return none("idle", "Raumtemperatur fehlt.");
    }
    const coolEnabled = (0, config_1.acModeCommandEnabled)(unit.modeWhenCooling);
    const dryEnabled = (0, config_1.acModeCommandEnabled)(unit.modeWhenDehumidify) && unit.maxHumidityPct !== null;
    const heatEnabled = (0, config_1.acModeCommandEnabled)(unit.modeWhenHeating);
    const humidity = input.roomHumidityPct;
    const humidityHigh = dryEnabled && humidity !== null && humidity >= unit.maxHumidityPct;
    const humidityOffPct = dryEnabled
        ? Math.max(0, unit.maxHumidityPct - unit.humidityOffHysteresisPct)
        : null;
    const humidityLow = dryEnabled && humidity !== null && humidityOffPct !== null && humidity <= humidityOffPct;
    const tempHigh = temp >= unit.onTempC;
    const tempLow = temp <= unit.offTempC;
    const needCool = coolEnabled && tempHigh;
    const needDry = dryEnabled && humidityHigh;
    // Heating path reserved: only when mode string set (FSM demand not wired yet).
    void heatEnabled;
    /** Für die Hard-Off-Abwägung (compute_desired.ts) — 0, wenn aktuell kein Start-Bedarf besteht. */
    const demandUrgency01 = needCool
        ? (0, hard_off_worth_it_1.coolingDemandUrgency01)(temp, unit.onTempC)
        : needDry
            ? (0, hard_off_worth_it_1.dehumidifyDemandUrgency01)(humidity, unit.maxHumidityPct)
            : 0;
    if (!coolEnabled && !dryEnabled) {
        if ((0, time_1.switchIsOn)(input.feedbackSwitchRaw)) {
            return {
                state: "running",
                demandStart: false,
                demandStop: true,
                modePurpose: "cooling",
                reasonDe: "Kein Modus konfiguriert (cool/dry leer) — Abschalten.",
                demandUrgency01,
            };
        }
        return none("idle", "Kein Modus konfiguriert (cool/dry leer).");
    }
    // Cool has priority when temp is at/above on-temp; otherwise dry when humidity demands it.
    const modePurpose = needCool ? "cooling" : needDry ? "dehumidify" : "cooling";
    if ((0, time_1.switchIsOn)(input.feedbackSwitchRaw)) {
        if (needCool || needDry) {
            const why = needCool
                ? `Temp ${temp.toFixed(1)} °C ≥ ${unit.onTempC} °C — cool`
                : `Feuchte ${humidity.toFixed(0)} % ≥ ${unit.maxHumidityPct} % — dry`;
            return {
                state: "running",
                demandStart: false,
                demandStop: false,
                modePurpose,
                reasonDe: `Läuft (${why}).`,
                demandUrgency01,
            };
        }
        /*
         * Kühl-Hysterese VOR Feuchte-Aus: Sonst schaltet bei konfiguriertem Dry eine niedrige
         * Raumfeuchte ab, sobald Temp unter die Ein-Schwelle fällt — obwohl die Kühl-Aus-Schwelle
         * noch nicht erreicht ist → Takten + Reinigung, ohne bis offTempC durchzukühlen.
         */
        if (coolEnabled) {
            if (tempLow) {
                return {
                    state: "running",
                    demandStart: false,
                    demandStop: true,
                    modePurpose: "cooling",
                    reasonDe: `Temp ${temp.toFixed(1)} °C ≤ ${unit.offTempC} °C — Abschalten.`,
                    demandUrgency01,
                };
            }
            return {
                state: "running",
                demandStart: false,
                demandStop: false,
                modePurpose: "cooling",
                reasonDe: `Temp ${temp.toFixed(1)} °C im Hysterese-Bereich — läuft weiter.`,
                demandUrgency01,
            };
        }
        if (humidityLow) {
            return {
                state: "running",
                demandStart: false,
                demandStop: true,
                modePurpose: "dehumidify",
                reasonDe: `Feuchte ${humidity.toFixed(0)} % ≤ ${humidityOffPct} % — Entfeuchten fertig.`,
                demandUrgency01,
            };
        }
        // Dry-only: hold while humidity still above off-hysteresis.
        if (dryEnabled && !humidityLow) {
            return {
                state: "running",
                demandStart: false,
                demandStop: false,
                modePurpose: "dehumidify",
                reasonDe: `Feuchte im Hysterese-Bereich — dry läuft weiter.`,
                demandUrgency01,
            };
        }
        return {
            state: "running",
            demandStart: false,
            demandStop: true,
            modePurpose: "cooling",
            reasonDe: "Kein cool/dry-Bedarf — Abschalten.",
            demandUrgency01,
        };
    }
    // Switch off: start for cool and/or dry (dry may start even below cool off-temp).
    if (needCool || needDry) {
        const why = needCool
            ? `Temp ${temp.toFixed(1)} °C ≥ ${unit.onTempC} °C — cool`
            : `Feuchte ${humidity.toFixed(0)} % ≥ ${unit.maxHumidityPct} % — dry`;
        return {
            state: "idle",
            demandStart: true,
            demandStop: false,
            modePurpose,
            reasonDe: `${why} — Einschalten.`,
            demandUrgency01,
        };
    }
    if (!coolEnabled && dryEnabled && !humidityHigh) {
        return none("idle", "Dry konfiguriert, Feuchte unter Schwellwert.");
    }
    return none("idle", `Temp ${temp.toFixed(1)} °C im Hysterese-Bereich.`);
}
exports.evaluateAcUnitFsm = evaluateAcUnitFsm;
