"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSeasonallyPausedAddon = exports.isWinterOperationActive = exports.handleSeasonStateChange = exports.initSeasonControl = exports.WINTER_RUNTIME_STATE = void 0;
/** Laufzeit-Sperre für saisonal nicht verwendete Wärme-/Klima-Add-ons. */
let winterActive = false;
let configuredStateId = "";
let invertSignal = false;
exports.WINTER_RUNTIME_STATE = "global.winter_operation_active";
function config(host) {
    return host.config;
}
function boolValue(value) {
    if (value === true || value === 1 || value === "true" || value === "1" || value === "on")
        return true;
    if (value === false || value === 0 || value === "false" || value === "0" || value === "off")
        return false;
    return null;
}
async function publish(host, active) {
    winterActive = active;
    await host.setStateAsync(exports.WINTER_RUNTIME_STATE, { val: active, ack: true });
}
async function initSeasonControl(host) {
    const c = config(host);
    configuredStateId = String(c.winter_operation_state ?? "").trim();
    invertSignal = c.winter_operation_invert === true;
    await host.setObjectNotExistsAsync(exports.WINTER_RUNTIME_STATE, {
        type: "state",
        common: {
            name: "Winterbetrieb aktiv – Klima- und Heizstabplanung pausiert",
            type: "boolean",
            role: "indicator",
            read: true,
            write: false,
            def: false,
        },
        native: {},
    });
    if (!configuredStateId) {
        await publish(host, false);
        return;
    }
    const previous = boolValue((await host.getStateAsync(exports.WINTER_RUNTIME_STATE))?.val);
    const source = boolValue((await host.getStateAsync(configuredStateId))?.val);
    // Bei einem Ausfall nie eigenmächtig umschalten. Existiert noch kein
    // bestätigter Wert, ist Pausieren der sichere Erstzustand.
    await publish(host, source === null ? (previous ?? true) : (invertSignal ? !source : source));
    await host.subscribeForeignStatesAsync(configuredStateId);
    host.log.info(`Saisonsteuerung aktiv: ${configuredStateId}; Winter=${winterActive}`);
}
exports.initSeasonControl = initSeasonControl;
async function handleSeasonStateChange(host, id, state) {
    if (!configuredStateId || id !== configuredStateId || !state)
        return false;
    const source = boolValue(state.val);
    if (source === null) {
        host.log.warn("Winterbetrieb: ungültiger Eingangswert – letzter bestätigter Zustand bleibt erhalten");
        return true;
    }
    const next = invertSignal ? !source : source;
    if (next !== winterActive) {
        await publish(host, next);
        host.log.info(next
            ? "Winterbetrieb aktiv – Klima-/Heizstabplanung und EMS-Schreibbefehle pausiert"
            : "Sommerbetrieb aktiv – Klima-/Heizstabplanung wieder freigegeben");
    }
    return true;
}
exports.handleSeasonStateChange = handleSeasonStateChange;
function isWinterOperationActive() {
    return winterActive;
}
exports.isWinterOperationActive = isWinterOperationActive;
function isSeasonallyPausedAddon(addonId) {
    return winterActive && (addonId === "air_conditioning" || addonId === "immersion_heater");
}
exports.isSeasonallyPausedAddon = isSeasonallyPausedAddon;
