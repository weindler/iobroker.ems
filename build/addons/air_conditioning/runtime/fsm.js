"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateAcUnitFsm = void 0;
const time_1 = require("./time");
function evaluateAcUnitFsm(input) {
    const { unit } = input;
    const none = (state, reasonDe) => ({
        state,
        demandStart: false,
        demandStop: false,
        modePurpose: "cooling",
        reasonDe,
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
    const humidity = input.roomHumidityPct;
    const humidityHigh = unit.maxHumidityPct !== null && humidity !== null && humidity >= unit.maxHumidityPct;
    const tempHigh = temp >= unit.onTempC;
    const tempLow = temp <= unit.offTempC;
    let modePurpose = "cooling";
    if (humidityHigh && !tempHigh) {
        modePurpose = "dehumidify";
    }
    // Off-temperature always wins while the unit is on — humidity must not keep cooling forever.
    if (tempLow && (0, time_1.switchIsOn)(input.feedbackSwitchRaw)) {
        return {
            state: "running",
            demandStart: false,
            demandStop: true,
            modePurpose: "cooling",
            reasonDe: `Temp ${temp.toFixed(1)} °C ≤ ${unit.offTempC} °C — Abschalten.`,
        };
    }
    if (tempHigh || humidityHigh) {
        if ((0, time_1.switchIsOff)(input.feedbackSwitchRaw)) {
            const why = humidityHigh && !tempHigh ? "Feuchte hoch" : `Temp ${temp.toFixed(1)} °C ≥ ${unit.onTempC} °C`;
            return {
                state: "idle",
                demandStart: true,
                demandStop: false,
                modePurpose,
                reasonDe: `${why} — Einschalten.`,
            };
        }
        return {
            state: "running",
            demandStart: false,
            demandStop: false,
            modePurpose,
            reasonDe: `Läuft — Temp ${temp.toFixed(1)} °C.`,
        };
    }
    return none("idle", `Temp ${temp.toFixed(1)} °C im Hysterese-Bereich.`);
}
exports.evaluateAcUnitFsm = evaluateAcUnitFsm;
